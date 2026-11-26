import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildCatalog } from "../scripts/catalog.mjs";
import { createBridge, loadConfig, loopbackBase } from "../scripts/bridge.mjs";
import { createThinkingCodec, toMessagesRequest } from "../scripts/messages.mjs";

const key = "a".repeat(64), githubKey = "b".repeat(64);
const github = { models: [{
  slug: "same-model", priority: 0, display_name: "Existing model",
  base_instructions: "Synthetic fixture only.", truncation_policy: { mode: "tokens", limit: 10000 },
  supports_parallel_tool_calls: true, input_modalities: ["text", "image"], auto_compact_token_limit: 10000,
}] };
const windows = { data: [{
  id: "same-model", name: "Separate entitlement", supported_endpoints: ["/responses"],
  capabilities: { supports: { reasoning_effort: ["low", "medium"] }, limits: { max_context_window_tokens: 20000 } },
}, { id: "messages-only", supported_endpoints: ["/v1/messages"] }] };
const claude = {
  id: "claude-test", supported_endpoints: ["/v1/messages"],
  capabilities: { supports: { reasoning_effort: ["medium", "high"] }, limits: { max_context_window_tokens: 1000000 } },
};

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, { handler, timeoutMs, requestBudgetFile, messages = false } = {}) {
  const calls = [];
  const upstream = provider => http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ provider, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    if (handler) return handler(req, res);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n');
  });
  const githubBase = await listen(t, upstream("github")) + "/v1";
  const windowsBase = await listen(t, upstream("windows")) + "/v1";
  const options = {
    key, githubKey, githubBase, windowsBase,
    routes: buildCatalog(github, messages ? { data: [windows.data[0], claude] } : windows, { messages }).routes,
    timeoutMs, requestBudgetFile, enableMessages: messages,
  };
  const url = await listen(t, createBridge(options));
  const request = (model, fields = {}, path = "/v1/responses", headers = {}) => fetch(url + path, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify({ model, input: "synthetic-only", ...fields }),
  });
  return { calls, url, request, options };
}

test("Windows catalog preserves GitHub entries and separates overlapping IDs without fallback", () => {
  const before = structuredClone(github);
  const output = buildCatalog(github, windows);
  assert.deepEqual(github, before);
  assert.deepEqual(output.catalog.models[0], before.models[0]);
  const app = output.catalog.models[1];
  assert.equal(app.slug, "windows-copilot/same-model");
  assert.deepEqual(app.input_modalities, ["text"]);
  assert.equal(app.supports_parallel_tool_calls, false);
  assert.equal(app.auto_compact_token_limit, undefined);
  assert.deepEqual(output.excluded, [{ id: "messages-only", reason: "No native Responses endpoint" }]);
  assert.throws(() => buildCatalog(github, { data: [windows.data[0], windows.data[0]] }), /duplicated/);
  assert.throws(() => buildCatalog(github, { data: [{ ...windows.data[0], capabilities: {} }] }), /metadata/);
  assert.throws(() => buildCatalog(github, { data: [windows.data[1]] }), /No eligible/);
});

test("bridge routes both sources, preserves tools, and isolates client/GitHub credentials", async t => {
  const { request, calls } = await fixture(t);
  const tool = { type: "function", name: "synthetic", parameters: { type: "object" } };
  const fields = { stream: true, store: false, tools: [tool], reasoning: { effort: "medium" } };
  for (const model of ["same-model", "windows-copilot/same-model"]) {
    const response = await request(model, fields, "/v1/responses", { cookie: "synthetic-cookie", "x-api-key": "synthetic-key" });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /response.completed/);
  }
  assert.deepEqual(calls.map(c => c.provider), ["github", "windows"]);
  assert.deepEqual(calls.map(c => c.body.model), ["same-model", "same-model"]);
  for (const call of calls) {
    assert.equal(call.url, "/v1/responses");
    assert.deepEqual(call.body.tools, [tool]);
    assert.deepEqual(call.body.reasoning, fields.reasoning);
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers["x-api-key"], undefined);
  }
  assert.equal(calls[0].headers.authorization, `Bearer ${githubKey}`);
  assert.equal(calls[1].headers.authorization, undefined);
});

test("bridge rejects unauthenticated, browser, unknown, stored and unsupported requests before upstream", async t => {
  const { request, calls, url } = await fixture(t);
  assert.equal((await fetch(url + "/v1/models")).status, 401);
  assert.equal((await request("same-model", {}, "/v1/responses", { origin: "https://example.invalid" })).status, 403);
  // fetch normalizes Host on some Node versions; send an actual foreign Host.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(url + "/v1/models", { headers: { host: "example.invalid", authorization: `Bearer ${key}` } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on("error", reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await request("not-entitled")).status, 400);
  assert.equal((await request("windows-copilot/same-model", { store: true })).status, 400);
  assert.equal((await request("windows-copilot/same-model", {}, "/v1/responses/compact")).status, 501);
  assert.equal((await request("same-model", {}, "/v1/responses?leak=1")).status, 404);
  const response = await fetch(url + "/v1/models", { headers: { authorization: `Bearer ${key}` } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.map(m => m.id), ["same-model", "windows-copilot/same-model"]);
  assert.equal(calls.length, 0);
});

test("bridge preserves quota/policy failures and never retries or switches providers", async t => {
  const { request, calls } = await fixture(t, { handler: (_req, res) => {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "120" });
    res.end('{"error":{"code":"quota"}}');
  } });
  const response = await request("windows-copilot/same-model");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.equal(await response.text(), '{"error":{"code":"quota"}}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "windows");
});

test("bridge rejects redirects without forwarding a credential to their target", async t => {
  let destinationCalls = 0;
  const destination = await listen(t, http.createServer((_req, res) => { destinationCalls++; res.end(); }));
  const { request } = await fixture(t, { handler: (_req, res) => {
    res.writeHead(307, { location: destination }); res.end();
  } });
  assert.equal((await request("same-model")).status, 502);
  assert.equal(destinationCalls, 0);
});

test("truncated SSE is not converted into successful completion", async t => {
  const { request } = await fixture(t, { handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('event: response.created\ndata: {"type":"response.created"}\n\n');
    setTimeout(() => res.destroy(), 50);
  } });
  const response = await request("windows-copilot/same-model");
  await assert.rejects(response.text());
});

test("client cancellation aborts the upstream and deadlines do not retry", async t => {
  let closed;
  const aborted = new Promise(resolve => { closed = resolve; });
  const { url, calls } = await fixture(t, { handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"type":"response.created"}\n\n');
    res.on("close", closed);
  } });
  const controller = new AbortController();
  const response = await fetch(url + "/v1/responses", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model" }), signal: controller.signal,
  });
  assert.equal(response.status, 200);
  controller.abort();
  await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("not aborted")), 1000); timer.unref(); })]);
  assert.equal(calls.length, 1);
  const timed = await fixture(t, { handler: () => {}, timeoutMs: 100 });
  assert.equal((await timed.request("same-model")).status, 504);
  assert.equal(timed.calls.length, 1);
});

test("configuration prevents public upstreams, key reuse and alias-based fallback", async t => {
  for (const url of ["https://example.invalid/v1", "http://localhost:123/v1", "http://user:pass@127.0.0.1/v1", "http://127.0.0.1/v1?x=1", "http://127.0.0.1:0/v1", "http://127.0.0.1/v1"]) {
    assert.throws(() => loopbackBase(url));
  }
  const { options } = await fixture(t);
  assert.throws(() => createBridge({ ...options, key: githubKey }), /Distinct/);
  assert.throws(() => createBridge({ ...options, routes: { unknown: { provider: "windows", upstream_model: "same-model" } } }), /Invalid route/);
});

test("SSE arrives incrementally and GitHub compaction retains its original route", async t => {
  let release;
  const { request, calls } = await fixture(t, { timeoutMs: 2000, handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('event: response.created\ndata: {"type":"response.created"}\n\n');
    release = () => res.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  } });
  const response = await request("same-model", { input: [] }, "/v1/responses/compact");
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(Buffer.from(first.value).toString(), /response.created/);
  release();
  let rest = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    rest += Buffer.from(chunk.value).toString();
  }
  assert.match(rest, /response.completed/);
  assert.equal(calls[0].url, "/v1/responses/compact");
  assert.equal(calls[0].provider, "github");
});

async function privateFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "windows-copilot-synthetic-"));
  const checked = await realpath(root);
  const parent = await realpath(tmpdir());
  assert.ok(checked.startsWith(parent + sep));
  t.after(async () => {
    // Revalidate the exact owned root before recursive cleanup on Windows.
    assert.equal(await realpath(root), checked);
    await rm(checked, { recursive: true, force: true });
  });
  return root;
}

test("catalog CLI uses a fresh generation and never overwrites an existing catalog", async t => {
  const root = await privateFixture(t);
  await writeFile(join(root, "github.json"), JSON.stringify(github));
  await writeFile(join(root, "windows.json"), JSON.stringify(windows));
  const script = fileURLToPath(new URL("../scripts/catalog.mjs", import.meta.url));
  const args = [script, join(root, "github.json"), join(root, "windows.json"), join(root, "generation")];
  const run = () => spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8" });
  assert.equal(run().status, 0);
  const target = join(root, "generation/model-catalog.json");
  const original = await readFile(target, "utf8");
  assert.equal(run().status, 1);
  assert.equal(await readFile(target, "utf8"), original);
  assert.deepEqual(JSON.parse(original).models[0], github.models[0]);
});

test("private configuration loader rejects relative secrets and self-routing before listening", async t => {
  const root = await privateFixture(t);
  await writeFile(join(root, "bridge-key"), key);
  await writeFile(join(root, "github-key"), githubKey);
  await writeFile(join(root, "routes.json"), JSON.stringify(buildCatalog(github, windows).routes));
  const file = join(root, "config.json");
  const config = {
    port: 47832, key_file: join(root, "bridge-key"), routes_file: join(root, "routes.json"),
    github: { base_url: "http://127.0.0.1:47831/v1", key_file: join(root, "github-key") },
    windows: { base_url: "http://127.0.0.1:19324/v1" },
  };
  await writeFile(file, JSON.stringify(config));
  assert.equal((await loadConfig(file)).port, 47832);
  await writeFile(file, JSON.stringify({ ...config, key_file: "bridge-key" }));
  await assert.rejects(loadConfig(file), /absolute/);
  await writeFile(file, JSON.stringify({ ...config, port: 19324 }));
  await assert.rejects(loadConfig(file), /own port/);
});

test("approved live budget persists across bridge restarts and fails closed", async t => {
  const root = await privateFixture(t);
  const ledger = join(root, "budget.json");
  await writeFile(ledger, JSON.stringify({ schema_version: 1, limit: 2, used: 0 }));
  const first = await fixture(t, { requestBudgetFile: ledger });
  assert.equal((await first.request("unknown")).status, 400);
  for (const model of ["same-model", "windows-copilot/same-model"]) {
    const response = await first.request(model);
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.equal(JSON.parse(await readFile(ledger, "utf8")).used, 2);
  const second = await fixture(t, { requestBudgetFile: ledger });
  assert.equal((await second.request("same-model")).status, 429);
  assert.equal(second.calls.length, 0);
  await writeFile(ledger, "invalid");
  assert.equal((await second.request("same-model")).status, 503);
  assert.equal(second.calls.length, 0);
  assert.equal(await readFile(ledger, "utf8"), "invalid");
});

function messageEvents(content, stopReason = "end_turn") {
  const events = [{
    type: "message_start",
    message: { id: "msg_upstream", type: "message", role: "assistant", model: "claude-test", content: [], usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } },
  }];
  for (const [index, block] of content.entries()) {
    const initial = block.type === "text" ? { type: "text", text: "" }
      : block.type === "tool_use" ? { ...block, input: {} }
        : block.type === "thinking" ? { type: "thinking", thinking: "", signature: "" } : block;
    events.push({ type: "content_block_start", index, content_block: initial });
    if (block.type === "text") events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    if (block.type === "tool_use") {
      const json = JSON.stringify(block.input);
      for (const part of [json.slice(0, 4), json.slice(4)]) events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: part } });
    }
    if (block.type === "thinking") {
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
      events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
    }
    events.push({ type: "content_block_stop", index });
  }
  events.push({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } });
  events.push({ type: "llmapi.call_cost", cost: "not converted to token counts" }, { type: "message_stop" });
  return events;
}

const messageWire = events => events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join("");
const responseEvents = text => text.split(/\r?\n\r?\n/).map(frame =>
  frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5)).join("\n")
).filter(Boolean).map(data => JSON.parse(data));

test("Messages catalog is opt-in, metadata-bound and does not change native routes", async t => {
  const data = { data: [windows.data[0], claude] };
  const native = buildCatalog(github, data);
  const translated = buildCatalog(github, data, { messages: true });
  assert.deepEqual(translated.catalog.models.slice(0, 2), native.catalog.models);
  assert.equal(translated.catalog.models[2].slug, "windows-copilot/claude-test");
  assert.equal(translated.routes["windows-copilot/claude-test"].protocol, "messages");
  assert.deepEqual(translated.routes["windows-copilot/claude-test"].reasoning_efforts, ["medium", "high"]);
  assert.deepEqual(translated.routes["windows-copilot/same-model"], native.routes["windows-copilot/same-model"]);
  const { options } = await fixture(t, { messages: true });
  assert.throws(() => createBridge({ ...options, enableMessages: false }), /opt-in/);
  const invalid = structuredClone(data);
  invalid.data[1].capabilities.supports.reasoning_effort = ["none"];
  assert.throws(() => buildCatalog(github, invalid, { messages: true }), /metadata/);
});

test("Messages conversion preserves roles, namespaced/freeform tools and authenticated thinking state", () => {
  const codec = createThinkingCodec(key);
  const model = "windows-copilot/claude-test";
  const route = buildCatalog(github, { data: [claude] }, { messages: true }).routes[model];
  const thought = { type: "thinking", thinking: "Synthetic private reasoning", signature: "synthetic-signature" };
  const sealed = codec.seal(thought, model);
  assert.deepEqual(createThinkingCodec(key).open(sealed, model), thought);
  assert.throws(() => createThinkingCodec(githubKey).open(sealed, model), /reasoning_state/);
  assert.throws(() => codec.open(sealed, "windows-copilot/other"), /reasoning_state/);
  const body = {
    model, stream: true, reasoning: { effort: "high" }, parallel_tool_calls: false,
    tools: [
      { type: "namespace", name: "ns", tools: [{ type: "function", name: "read", parameters: { type: "object" } }] },
      { type: "custom", name: "apply_patch", description: "Apply patch", format: { type: "grammar", syntax: "lark", definition: 'start: "patch"' } },
    ],
    input: [
      { role: "developer", content: "Keep the instructions." },
      { role: "user", content: "Use tools." },
      { type: "reasoning", encrypted_content: sealed, summary: [] },
      { type: "function_call", name: "read", namespace: "ns", call_id: "call_read", arguments: '{"path":"synthetic"}' },
      { type: "custom_tool_call", name: "apply_patch", call_id: "call_patch", input: "patch" },
      { type: "function_call_output", call_id: "call_read", output: "file contents" },
      { type: "custom_tool_call_output", call_id: "call_patch", output: "applied" },
      { role: "user", content: "Finish." },
    ],
  };
  const result = toMessagesRequest(body, route, codec);
  assert.deepEqual(result.request.system, [{ type: "text", text: "Keep the instructions." }]);
  assert.deepEqual(result.request.thinking, { type: "adaptive" });
  assert.deepEqual(result.request.output_config, { effort: "high" });
  assert.equal(result.request.tool_choice.disable_parallel_tool_use, true);
  assert.deepEqual(result.request.messages.map(message => message.role), ["user", "assistant", "user"]);
  assert.deepEqual(result.request.messages[1].content[0], thought);
  assert.equal(result.request.messages[1].content[1].name, result.request.tools[0].name);
  assert.deepEqual(result.request.messages[1].content[2].input, { input: "patch" });
  assert.equal(result.request.messages[2].content[0].tool_use_id, "call_read");
  assert.equal(result.request.messages[2].content[1].tool_use_id, "call_patch");
  assert.match(result.request.tools[1].description, /start: "patch"/);
  assert.equal(result.names.get(result.request.tools[0].name).namespace, "ns");
});

test("Messages input rejects unsupported semantics before forwarding or spending budget", async t => {
  const { request, calls } = await fixture(t, { messages: true });
  for (const fields of [
    { previous_response_id: "resp_missing" }, { truncation: "auto" },
    { reasoning: { effort: "none" } }, { max_output_tokens: 128001 },
    { tools: [{ type: "web_search" }] }, { tool_choice: "required" },
    { text: { format: { type: "json_schema" } } },
    { input: [{ type: "input_file", file_id: "private" }] },
    { input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/private" }] }] },
    { input: [{ type: "reasoning", encrypted_content: "foreign" }] },
    { input: [{ type: "function_call_output", call_id: "orphan", output: "result" }] },
  ]) {
    const result = await request("windows-copilot/claude-test", fields);
    assert.equal(result.status, 400);
    assert.match((await result.json()).error.code, /^messages_/);
  }
  assert.equal(calls.length, 0);
});

test("Messages SSE preserves incremental text, usage, item identity and full signed tool history", async t => {
  let release;
  const thought = { type: "thinking", thinking: "Synthetic private state", signature: "signed-synthetic-state" };
  const tools = [{ type: "namespace", name: "ns", tools: [{ type: "function", name: "read", parameters: { type: "object" } }] }];
  const { request, calls } = await fixture(t, { messages: true, handler: (_req, res) => {
    const current = calls.at(-1);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const events = calls.length === 1
      ? messageEvents([thought, { type: "text", text: "Checking \u2713" }, { type: "tool_use", id: "toolu_synthetic", name: current.body.tools[0].name, input: { path: "fixture" } }, { type: "text", text: "Waiting for the tool result." }], "tool_use")
      : messageEvents([{ type: "text", text: "DONE" }]);
    if (calls.length === 1) {
      res.write(messageWire(events.slice(0, 1)));
      release = () => res.end(messageWire(events.slice(1)));
    } else res.end(messageWire(events));
  } });
  const first = await request("windows-copilot/claude-test", { stream: true, tools, reasoning: { effort: "high" } });
  const reader = first.body.getReader();
  let text = Buffer.from((await reader.read()).value).toString();
  assert.match(text, /response.created/);
  assert.doesNotMatch(text, /response.completed/);
  release();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += Buffer.from(chunk.value).toString();
  }
  assert.doesNotMatch(text, /Synthetic private state|signed-synthetic-state/);
  const events = responseEvents(text);
  assert.deepEqual(events.map(event => event.sequence_number), events.map((_, i) => i));
  const completed = events.filter(event => event.type === "response.completed");
  assert.equal(completed.length, 1);
  const result = completed[0].response;
  assert.deepEqual(result.usage, { input_tokens: 15, input_tokens_details: { cached_tokens: 3 }, output_tokens: 7, total_tokens: 22 });
  const output = result.output;
  const call = output.find(item => item.type === "function_call");
  assert.equal(call.name, "read");
  assert.equal(call.namespace, "ns");
  assert.equal(call.call_id, "toolu_synthetic");
  assert.equal(call.arguments, '{"path":"fixture"}');
  assert.ok(events.some(event => event.type === "response.function_call_arguments.delta" && event.item_id === call.id));
  assert.ok(events.some(event => event.type === "response.output_item.done" && event.item.id === call.id));
  const second = await request("windows-copilot/claude-test", {
    stream: false, tools, reasoning: { effort: "high" },
    input: [{ role: "user", content: "Check." }, ...output, { type: "function_call_output", call_id: call.call_id, output: "OK" }],
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).output[0].content[0].text, "DONE");
  assert.equal(calls[1].url, "/v1/messages");
  assert.equal(calls[1].headers.authorization, undefined);
  assert.deepEqual(calls[1].body.messages[1].content[0], thought);
});

test("Messages freeform tool output becomes the same Codex custom tool, not a replacement function", async t => {
  const { request } = await fixture(t, { messages: true, handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(messageWire(messageEvents([{ type: "tool_use", id: "toolu_patch", name: "apply_patch", input: { input: "*** Begin Patch\n*** End Patch" } }], "tool_use")));
  } });
  const result = await request("windows-copilot/claude-test", { stream: true, tools: [{ type: "custom", name: "apply_patch" }] });
  const events = responseEvents(await result.text());
  const call = events.find(event => event.type === "response.completed").response.output[0];
  assert.equal(call.type, "custom_tool_call");
  assert.equal(call.name, "apply_patch");
  assert.equal(call.input, "*** Begin Patch\n*** End Patch");
  assert.ok(events.some(event => event.type === "response.custom_tool_call_input.done" && event.item_id === call.id && event.input === call.input));
});

test("Messages truncation, upstream errors and refusal never produce a successful completion", async t => {
  const normal = messageEvents([{ type: "text", text: "partial" }]);
  for (const [name, events, terminal] of [
    ["missing stop", normal.slice(0, -1), "error"],
    ["overloaded", [{ type: "error", error: { type: "overloaded_error" } }], null],
    ["refusal", messageEvents([{ type: "text", text: "refused" }], "refusal"), "error"],
    ["length", messageEvents([{ type: "text", text: "partial" }], "max_tokens"), "response.incomplete"],
    ["unknown block", messageEvents([{ type: "server_tool_use" }]), "error"],
  ]) {
    await t.test(name, async sub => {
      const { request } = await fixture(sub, { messages: true, handler: (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" }); res.end(messageWire(events));
      } });
      const result = await request("windows-copilot/claude-test", { stream: true });
      const text = await result.text();
      assert.doesNotMatch(text, /"type":"response.completed"/);
      if (terminal) assert.ok(responseEvents(text).some(event => event.type === terminal));
      else assert.equal(result.status, 502);
    });
  }
});

test("Messages length limits cannot dispatch a partially completed tool, and upstream 429 stays 429", async t => {
  const tool = { type: "function", name: "read", parameters: { type: "object" } };
  const limited = await fixture(t, { messages: true, handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(messageWire(messageEvents([{ type: "tool_use", id: "toolu_limited", name: "read", input: {} }], "max_tokens")));
  } });
  const result = await limited.request("windows-copilot/claude-test", { stream: true, tools: [tool] });
  const events = responseEvents(await result.text());
  assert.ok(events.some(event => event.type === "response.incomplete"));
  assert.ok(!events.some(event => event.type === "response.output_item.done" && event.item.type === "function_call"));
  const denied = await fixture(t, { messages: true, handler: (_req, res) => {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
    res.end('{"error":{"type":"rate_limit_error"}}');
  } });
  const rejection = await denied.request("windows-copilot/claude-test");
  assert.equal(rejection.status, 429);
  assert.equal(rejection.headers.get("retry-after"), "60");
  assert.equal((await rejection.json()).error.type, "rate_limit_error");
  assert.equal(denied.calls.length, 1);
});

test("native routes omit only adapter reasoning on a protocol switch and retain visible and native history", async t => {
  const adapterItem = {
    type: "reasoning", id: "rs_wcm_" + "1".repeat(32), summary: [],
    encrypted_content: createThinkingCodec(key).seal(
      { type: "thinking", thinking: "Synthetic private state", signature: "synthetic signature" },
      "windows-copilot/claude-test",
    ),
  };
  const history = [
    { role: "user", content: "Retain the visible conversation." },
    adapterItem,
    { role: "assistant", content: [{ type: "output_text", text: "Visible reply." }] },
    { type: "function_call", name: "read", call_id: "call_kept", arguments: "{}" },
    { type: "function_call_output", call_id: "call_kept", output: "Visible tool result." },
    { type: "reasoning", id: "rs_native", encrypted_content: "native-provider-state", summary: [] },
    { type: "reasoning", id: "rs_wcm_" + "2".repeat(32), encrypted_content: "native-provider-state", summary: [] },
    { type: "reasoning", id: "rs_native_2", encrypted_content: adapterItem.encrypted_content, summary: [] },
    { ...adapterItem, id: "rs_wcm_" + "3".repeat(32), summary: [{ type: "summary_text", text: "Visible summary must not be dropped." }] },
    { ...adapterItem, id: "rs_wcm_" + "4".repeat(32), content: [{ type: "reasoning_text", text: "Synthetic nonopaque content." }] },
  ];
  const original = structuredClone(history);
  const { request, calls } = await fixture(t, { handler: (_req, res) => {
    if (calls.at(-1).body.input.some(item => item.id === adapterItem.id)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end('{"error":{"code":"invalid_encrypted_content"}}');
    } else {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"response.completed","response":{"status":"completed"}}\n\n');
    }
  } });
  for (const model of ["same-model", "windows-copilot/same-model"]) {
    const response = await request(model, { input: history, stream: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-copilot-bridge-omitted-reasoning"), "1");
    await response.text();
    assert.deepEqual(calls.at(-1).body.input, history.filter(item => item !== adapterItem));
  }
  assert.deepEqual(history, original, "The stored conversation is not rewritten.");
});

test("Messages permits mixed assistant tool content but rejects interrupted parallel-result groups", () => {
  const model = "windows-copilot/claude-test";
  const route = buildCatalog(github, { data: [claude] }, { messages: true }).routes[model];
  const codec = createThinkingCodec(key);
  const user = { role: "user", content: "Use both tools." };
  const call = id => ({ type: "function_call", name: "fixture", call_id: id, arguments: "{}" });
  const result = id => ({ type: "function_call_output", call_id: id, output: "OK" });
  const text = { role: "assistant", content: "More assistant text in the same turn." };
  const convert = input => toMessagesRequest({ model, input, reasoning: { effort: "high" } }, route, codec);
  const accepted = convert([user, call("one"), text, call("two"), text, result("one"), result("two")]);
  assert.deepEqual(accepted.request.messages.map(message => message.role), ["user", "assistant", "user"]);
  assert.deepEqual(accepted.request.messages[1].content.map(block => block.type), ["tool_use", "text", "tool_use", "text"]);
  assert.throws(() => convert([user, call("one"), user, result("one")]), /tool_results_required/);
  for (const interrupted of [
    text,
    call("three"),
    { type: "reasoning", summary: [], encrypted_content: codec.seal({ type: "thinking", thinking: "", signature: "synthetic" }, model) },
  ]) {
    assert.throws(() => convert([user, call("one"), call("two"), result("one"), interrupted, result("two")]), /tool_results_required/);
  }
});

test("Messages truncated tool JSON remains incomplete in SSE and JSON responses", async t => {
  for (const type of ["function", "custom"]) {
    for (const stream of [true, false]) {
      await t.test(`${type} stream=${stream}`, async sub => {
        const partial = type === "custom" ? '{"input":"unfinished' : '{"value":';
        const events = messageEvents([{ type: "tool_use", id: "toolu_cut", name: "fixture", input: {} }], "max_tokens");
        const deltas = events.filter(event => event.delta?.type === "input_json_delta");
        deltas[0].delta.partial_json = partial;
        deltas[1].delta.partial_json = "";
        const { request } = await fixture(sub, { messages: true, handler: (_req, res) => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(messageWire(events));
        } });
        const tool = { type, name: "fixture", ...(type === "function" ? { parameters: { type: "object" } } : {}) };
        const response = await request("windows-copilot/claude-test", { stream, tools: [tool] });
        assert.equal(response.status, 200);
        let output;
        if (stream) {
          const translated = responseEvents(await response.text());
          assert.ok(!translated.some(event => ["error", "response.completed", "response.output_item.done"].includes(event.type)));
          output = translated.find(event => event.type === "response.incomplete")?.response;
        } else output = await response.json();
        assert.equal(output.status, "incomplete");
        assert.deepEqual(output.incomplete_details, { reason: "max_output_tokens" });
        assert.equal(output.output[0].status, "incomplete");
        if (type === "function") assert.equal(output.output[0].arguments, partial);
        else assert.equal(output.output[0].input, "", "Truncated JSON wrappers must not become freeform tool input.");
      });
    }
  }
});

test("Messages malformed completed tools fail before any valid tool is dispatched", async t => {
  const events = messageEvents([
    { type: "tool_use", id: "toolu_valid", name: "fixture", input: {} },
    { type: "tool_use", id: "toolu_invalid", name: "fixture", input: {} },
  ], "tool_use");
  const deltas = events.filter(event => event.index === 1 && event.delta?.type === "input_json_delta");
  deltas[0].delta.partial_json = '{"value":';
  deltas[1].delta.partial_json = "";
  const { request } = await fixture(t, { messages: true, handler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.end(messageWire(events));
  } });
  const response = await request("windows-copilot/claude-test", {
    stream: true, tools: [{ type: "function", name: "fixture", parameters: { type: "object" } }],
  });
  const translated = responseEvents(await response.text());
  assert.ok(translated.some(event => event.type === "error" && event.code === "messages_upstream_tool_json_invalid"));
  assert.ok(!translated.some(event => ["response.output_item.done", "response.completed", "response.incomplete"].includes(event.type)));
});
