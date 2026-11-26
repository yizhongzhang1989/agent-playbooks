import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBudget, reserveRequest } from "./budget.mjs";
import { createThinkingCodec, forwardMessages, MESSAGE_EFFORTS, MessagesError, toMessagesRequest } from "./messages.mjs";

const BODY_LIMIT = 8 * 1024 * 1024;
const RESPONSE_HEADERS = ["content-type", "content-encoding", "retry-after", "x-request-id", "request-id", "www-authenticate"];
const CLIENT_HEADERS = ["accept", "openai-beta", "x-conversationid"];
const keyValid = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function loopbackBase(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !url.port || Number(url.port) < 1 ||
      url.username || url.password || url.search || url.hash ||
      !["/v1", "/v1/"].includes(url.pathname)) {
    throw new Error("Only an explicit http://127.0.0.1:<port>/v1 upstream is supported.");
  }
  return url.href.replace(/\/$/, "");
}

function reply(res, status, code) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: { type: "bridge_error", code, message: code } }));
}

function authenticate(header, key) {
  const expected = Buffer.from(`Bearer ${key}`);
  const actual = Buffer.from(typeof header === "string" ? header : "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validateOptions(options) {
  if (!keyValid(options.key) || !keyValid(options.githubKey) || options.key === options.githubKey) {
    throw new Error("Distinct 32-byte hexadecimal bridge and GitHub keys are required.");
  }
  const github = loopbackBase(options.githubBase);
  const windows = loopbackBase(options.windowsBase);
  if (github === windows) throw new Error("Upstreams must be distinct.");
  const routes = structuredClone(options.routes);
  if (!routes || !Object.keys(routes).length) throw new Error("Explicit model routes are required.");
  for (const [id, route] of Object.entries(routes)) {
    if (!route || !["github", "windows"].includes(route.provider) ||
        typeof route.upstream_model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(route.upstream_model) ||
        id !== (route.provider === "windows" ? "windows-copilot/" : "") + route.upstream_model) {
      throw new Error("Invalid route: no aliases or implicit provider fallback are allowed.");
    }
    if (route.protocol !== undefined && route.protocol !== "messages") throw new Error("Unsupported route protocol.");
    if (route.protocol === "messages" && (options.enableMessages !== true || route.provider !== "windows" ||
        !Array.isArray(route.reasoning_efforts) || !route.reasoning_efforts.length ||
        route.reasoning_efforts.some(effort => !MESSAGE_EFFORTS.includes(effort)) ||
        !route.reasoning_efforts.includes(route.default_effort))) {
      throw new Error("Messages routes require explicit opt-in and actual reasoning metadata.");
    }
  }
  const timeoutMs = options.timeoutMs ?? 180000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error("Invalid request deadline.");
  if (options.requestBudgetFile !== undefined) readBudget(options.requestBudgetFile);
  return { ...options, githubBase: github, windowsBase: windows, routes, timeoutMs };
}

export function createBridge(input) {
  const options = validateOptions(input);
  const thinkingCodec = createThinkingCodec(options.key);
  const server = http.createServer(async (req, res) => {
    // Host validation also prevents DNS rebinding; Origin blocks browser fetches.
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost || req.headers.origin !== undefined) return reply(res, 403, "local_client_required");
    if (!authenticate(req.headers.authorization, options.key)) return reply(res, 401, "invalid_bridge_key");
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", scope: "bridge_only", upstream_verified: false }));
    }
    if (req.url === "/v1/models" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ object: "list", data: Object.keys(options.routes).map(id => ({ id, object: "model" })) }));
    }
    if (!["/v1/responses", "/v1/responses/compact"].includes(req.url) || req.method !== "POST") {
      return reply(res, 404, "unsupported_route");
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) return reply(res, 415, "json_required");
    let upstream;
    let ended = false;
    const deadline = setTimeout(() => {
      upstream?.destroy();
      if (!res.headersSent) reply(res, 504, "request_deadline");
      else res.destroy();
    }, options.timeoutMs);
    deadline.unref();
    res.on("close", () => { clearTimeout(deadline); if (!ended) upstream?.destroy(); });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_LIMIT) { reply(res, 413, "body_too_large"); return; }
        chunks.push(chunk);
      }
      if (res.destroyed || res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reply(res, 400, "invalid_json"); }
      if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.model !== "string") {
        return reply(res, 400, "model_required");
      }
      const route = Object.hasOwn(options.routes, body.model) && options.routes[body.model];
      if (!route) return reply(res, 400, "unknown_model");
      const isWindows = route.provider === "windows";
      if (isWindows && req.url.endsWith("/compact")) return reply(res, 501, "windows_compaction_unverified");
      if (isWindows && body.store !== undefined && body.store !== false) return reply(res, 400, "windows_requires_store_false");
      if (isWindows) body.store = false;
      let messages;
      if (route.protocol === "messages") {
        try { messages = toMessagesRequest(body, route, thinkingCodec); }
        catch (error) {
          if (!(error instanceof MessagesError)) throw error;
          return reply(res, error.status, error.code);
        }
      } else {
        if (Array.isArray(body.input)) {
          const previousLength = body.input.length;
          // Our Messages ciphertext has no meaning to a native Responses backend.
          body.input = body.input.filter(item => !(item?.type === "reasoning" &&
            /^rs_wcm_[a-f0-9]{32}$/.test(item.id) &&
            (item.summary === undefined || Array.isArray(item.summary) && item.summary.length === 0) &&
            (item.content == null || Array.isArray(item.content) && item.content.length === 0) &&
            typeof item.encrypted_content === "string" && item.encrypted_content.startsWith("wcm1.")));
          const omitted = previousLength - body.input.length;
          if (omitted) {
            console.warn(`Native Responses route omitted ${omitted} Messages-only reasoning item(s); visible history unchanged.`);
            res.setHeader("x-copilot-bridge-omitted-reasoning", String(omitted));
          }
        }
        body.model = route.upstream_model;
      }
      const payload = Buffer.from(JSON.stringify(messages ? messages.request : body));
      const headers = { "content-type": "application/json", "content-length": payload.length, "accept-encoding": "identity" };
      for (const name of CLIENT_HEADERS) {
        if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
      }
      // Never forward the bridge key, cookies, x-api-key or arbitrary client headers.
      if (!isWindows) headers.authorization = `Bearer ${options.githubKey}`;
      const base = isWindows ? options.windowsBase : options.githubBase;
      if (options.requestBudgetFile !== undefined) {
        try {
          if (!reserveRequest(options.requestBudgetFile)) return reply(res, 429, "approved_request_budget_exhausted");
        } catch {
          return reply(res, 503, "request_budget_unavailable");
        }
      }
      upstream = http.request(base + (messages ? "/messages" : req.url.slice(3)), { method: "POST", headers }, response => {
        if (res.destroyed || res.writableEnded) { response.destroy(); return; }
        // Do not follow redirects, forward redirect locations, or attach credentials to another host.
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          return reply(res, 502, "upstream_redirect_rejected");
        }
        if (messages && response.statusCode === 200) {
          void forwardMessages(response, res, messages).then(() => { ended = true; }, error => {
            response.destroy();
            const code = error instanceof MessagesError ? error.code : "messages_upstream_unavailable";
            console.error(`Messages response failed: ${code}`);
            if (res.destroyed || res.writableEnded) return;
            if (!res.headersSent) reply(res, 502, code);
            else res.end(`event: error\ndata: ${JSON.stringify({ type: "error", code, message: code })}\n\n`);
          });
          return;
        }
        const outHeaders = { "cache-control": "no-store" };
        for (const name of RESPONSE_HEADERS) if (response.headers[name] !== undefined) outHeaders[name] = response.headers[name];
        res.writeHead(response.statusCode, outHeaders);
        response.on("error", () => res.destroy());
        response.on("end", () => { ended = true; });
        response.pipe(res);
      });
      upstream.on("error", () => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) res.destroy();
        else reply(res, 502, "upstream_unavailable");
      });
      upstream.end(payload);
    } catch {
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) res.destroy();
        else reply(res, 400, "request_failed");
      }
    }
  });
  server.requestTimeout = options.timeoutMs;
  server.headersTimeout = Math.min(30000, options.timeoutMs);
  return server;
}

export async function loadConfig(path) {
  const config = JSON.parse(await readFile(path, "utf8"));
  const paths = [config.key_file, config.github?.key_file, config.routes_file];
  if (!paths.every(p => typeof p === "string" && isAbsolute(p))) throw new Error("Use absolute private configuration paths.");
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error("Invalid bridge port.");
  const [key, githubKey, routes] = await Promise.all(paths.map(p => readFile(p, "utf8")));
  const options = {
    key: key.trim(), githubKey: githubKey.trim(), routes: JSON.parse(routes),
    githubBase: config.github.base_url, windowsBase: config.windows.base_url,
    timeoutMs: config.timeout_ms ?? 180000,
    requestBudgetFile: config.request_budget_file,
    enableMessages: config.enable_messages,
  };
  validateOptions(options);
  if ([options.githubBase, options.windowsBase].some(base => new URL(base).port === String(config.port))) {
    throw new Error("The bridge cannot forward to its own port.");
  }
  return { port: config.port, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.env.COPILOT_BRIDGE_CONFIG || !isAbsolute(process.env.COPILOT_BRIDGE_CONFIG)) {
      throw new Error("Set COPILOT_BRIDGE_CONFIG to an absolute private file.");
    }
    const { port, options } = await loadConfig(process.env.COPILOT_BRIDGE_CONFIG);
    const server = createBridge(options);
    server.on("error", () => { console.error("Bridge listener failed; no existing service was stopped."); process.exitCode = 1; });
    server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ status: "listening", host: "127.0.0.1", port })));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); });
  } catch {
    console.error("Bridge configuration rejected. Check private paths, separate keys, loopback URLs and explicit routes.");
    process.exitCode = 1;
  }
}
