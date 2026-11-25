import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  absolutePath, check, cli, isMain, privateFile, readPrivateJson, validateGateway,
} from "./common.mjs";

export function localOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    check(false, "INVALID_ORIGIN", "Expected an HTTP loopback origin.");
  }
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" &&
    url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password,
  "NONLOCAL_ORIGIN", "Credentials may only be sent to an HTTP origin on 127.0.0.1.");
  return url.origin;
}

export function completedMarker(raw) {
  const events = [];
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      check(false, "INVALID_SSE", "A stream event was not valid JSON.");
    }
  }
  check(!events.some(event => ["error", "response.failed", "response.incomplete"].includes(event?.type)),
    "UPSTREAM_FAILURE", "The stream contained an error, failed or incomplete event.");
  const completed = events.find(event => event?.type === "response.completed");
  check(completed && Array.isArray(completed.response?.output), "MISSING_COMPLETION", "No valid response.completed output was received.");
  const output = completed.response.output
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === "output_text")
    .map(item => item.text).join("").trim();
  check(output === "CODEX_PROXY_OK", "OUTPUT_MISMATCH", "Completed output did not exactly match the probe marker.");
}

export async function verify({ root, codexHome, mode = "offline", baseUrl = "http://127.0.0.1:4141", model, effort, probeEffort, allowPaidRequest = false }) {
  check(["offline", "catalog", "live"].includes(mode), "INVALID_MODE", "Mode must be offline, catalog or live.");
  check(mode !== "live" || allowPaidRequest, "PAID_PROBE_NOT_APPROVED", "Live mode requires --allow-paid-request after user authorization.");
  check(!allowPaidRequest || mode === "live", "INVALID_MODE", "Paid-request permission is only meaningful in live mode.");
  const origin = localOrigin(baseUrl);
  const target = absolutePath(root);
  const versions = await readPrivateJson(new URL("../versions.json", import.meta.url), "Version metadata");
  const selectedModel = model ?? versions.model_reference;
  const selectedEffort = effort ?? versions.reasoning_reference;
  const selectedProbeEffort = probeEffort ?? versions.probe_reasoning_reference;
  check([selectedModel, selectedEffort, selectedProbeEffort].every(value => typeof value === "string" && value.trim().length > 0),
    "INVALID_MODEL_SELECTION", "Model and reasoning selections must be nonempty.");
  await privateFile(join(target, "gateway/config.json"));
  const config = await readPrivateJson(join(target, "gateway/config.json"), "Gateway configuration");
  const key = validateGateway(config);
  const token = await privateFile(join(target, "gateway/github_token"));
  check(token.size > 0, "AUTH_NOT_SAVED", "GitHub authorization file is empty; wait for device login to finish.");
  const checks = { gateway_config: "passed", github_token_file_nonempty: "passed" };
  if (codexHome !== undefined) {
    const home = absolutePath(codexHome);
    await privateFile(join(home, "auth.json"));
    await privateFile(join(home, "config.toml"));
    const auth = await readPrivateJson(join(home, "auth.json"), "Client authentication");
    check(auth.auth_mode === "apikey" && typeof auth.OPENAI_API_KEY === "string" &&
      config.auth.apiKeys.includes(auth.OPENAI_API_KEY) && auth.OPENAI_API_KEY !== config.auth.adminApiKey,
    "CLIENT_KEY_MISMATCH", "Client authentication must match an ordinary gateway API key.");
    checks.client_key_match = "passed";
  }
  if (mode === "offline") {
    return { status: "passed", mode, checks, not_tested: ["gateway_http", "model_inference", "cli", "vscode_ui", "system_reboot"] };
  }
  const request = (path, options = {}) => fetch(origin + path, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(path === "/v1/responses" ? 120000 : 30000),
  });
  const health = await request("/");
  check(health.status === 200 && (await health.text()).trim() === "Server running", "HEALTH_FAILED", "Gateway health response was unexpected.");
  const unauthenticated = await request("/v1/models");
  check(unauthenticated.status === 401, "AUTH_BYPASS", "Unauthenticated models access must return HTTP 401.");
  checks.http_authentication = "passed";
  for (const [path, agent, field] of [["/v1/models", "gateway-check", "data"], ["/models", "codex_proxy_probe/0.166.0", "models"]]) {
    const response = await request(path, { headers: { authorization: `Bearer ${key}`, "user-agent": agent } });
    check(response.status === 200, "CATALOG_HTTP_FAILED", `Authenticated catalog returned HTTP ${response.status}.`);
    const body = await response.json();
    check(Array.isArray(body[field]) && body[field].length > 0, "CATALOG_SHAPE", "Catalog response has the wrong list shape.");
    if (field === "models") {
      const selected = body.models.find(item => (item.slug || item.id) === selectedModel);
      check(selected && Array.isArray(selected.supported_reasoning_levels), "MODEL_UNAVAILABLE", "Target model or its reasoning capabilities are unavailable.");
      const efforts = selected.supported_reasoning_levels.map(level => typeof level === "string" ? level : level.effort);
      check(efforts.includes(selectedEffort) && efforts.includes(selectedProbeEffort), "EFFORT_UNAVAILABLE", "Selected normal/probe reasoning effort is unavailable.");
    }
  }
  checks.model_catalogs = "passed";
  if (mode === "live") {
    const response = await request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "codex_proxy_probe/0.166.0" },
      body: JSON.stringify({
        model: selectedModel,
        instructions: "This is a connectivity check. Reply only with the requested marker. Do not call tools.",
        input: [{ role: "user", content: [{ type: "input_text", text: "Reply exactly CODEX_PROXY_OK." }] }],
        reasoning: { effort: selectedProbeEffort },
        stream: true,
        store: false,
        max_output_tokens: 256,
      }),
    });
    check(response.status === 200, "RESPONSE_HTTP_FAILED", `Responses probe returned HTTP ${response.status}.`);
    check(response.headers.get("content-type")?.includes("text/event-stream"), "NOT_SSE", "Expected a text/event-stream response.");
    completedMarker(await response.text());
    checks.response_completed_marker = "passed";
  }
  return { status: "passed", mode, checks, not_tested: [...(mode === "catalog" ? ["model_inference"] : []), "cli", "vscode_ui", "system_reboot"] };
}

if (isMain(import.meta.url)) {
  await cli(async () => {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        "codex-home": { type: "string" },
        mode: { type: "string", default: "offline" },
        "base-url": { type: "string", default: "http://127.0.0.1:4141" },
        model: { type: "string" },
        effort: { type: "string" },
        "probe-effort": { type: "string" },
        "allow-paid-request": { type: "boolean", default: false },
      },
    });
    return verify({
      root: values.root, codexHome: values["codex-home"], mode: values.mode,
      baseUrl: values["base-url"], model: values.model, effort: values.effort,
      probeEffort: values["probe-effort"], allowPaidRequest: values["allow-paid-request"],
    });
  });
}
