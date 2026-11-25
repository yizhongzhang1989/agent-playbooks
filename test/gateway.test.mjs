import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ROOT } from "../tools/lib.mjs";
import { createGatewayConfig } from "../skills/codex-copilot-gateway/scripts/create-gateway-config.mjs";
import { createPrivateDirectory, privateFile } from "../skills/codex-copilot-gateway/scripts/common.mjs";
import { completedMarker, localOrigin, verify } from "../skills/codex-copilot-gateway/scripts/verify.mjs";

const execute = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "playbook-config-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPrivateDirectory(join(root, "gateway"));
  await createPrivateDirectory(join(root, "client"));
  await createGatewayConfig(root);
  const config = JSON.parse(await readFile(join(root, "gateway/config.json"), "utf8"));
  await writeFile(join(root, "gateway/github_token"), "synthetic-authorization", { mode: 0o600 });
  await writeFile(join(root, "client/config.toml"), 'model_provider = "copilot_api"\n', { mode: 0o600 });
  await writeFile(join(root, "client/auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: config.auth.apiKeys[0] }), { mode: 0o600 });
  return { root, config, codexHome: join(root, "client") };
}

test("configuration generation is private, non-overwriting and forbidden inside the source repository", async t => {
  const { root, config } = await fixture(t);
  await privateFile(join(root, "gateway/config.json"));
  if (process.platform !== "win32") assert.equal((await stat(join(root, "gateway/config.json"))).mode & 0o777, 0o600);
  assert.ok(config.auth.apiKeys[0] !== config.auth.adminApiKey);
  await assert.rejects(createGatewayConfig(root), { code: "EEXIST" });
  await assert.rejects(createGatewayConfig(ROOT), { code: "RUNTIME_IN_REPOSITORY" });
  assert.deepEqual(JSON.parse(await readFile(join(root, "gateway/config.json"), "utf8")), config);
});

test("Windows ACL checks reject unrelated principals without changing existing permissions", { skip: process.platform !== "win32" }, async t => {
  const context = await fixture(t);
  const keyFile = join(context.root, "gateway/config.json");
  await execute("icacls.exe", [keyFile, "/grant", "*S-1-1-0:(R)"]);
  await assert.rejects(verify(context), { code: "UNSAFE_PERMISSIONS" });
  await assert.rejects(privateFile(keyFile), { code: "UNSAFE_PERMISSIONS" });
  await execute("icacls.exe", [join(context.root, "gateway"), "/grant", "*S-1-1-0:(OI)(CI)(R)"]);
  await assert.rejects(createGatewayConfig(context.root), { code: "UNSAFE_PERMISSIONS" });
});

test("offline verification rejects pending authorization and mismatched client keys without leaking values", async t => {
  const context = await fixture(t);
  assert.equal((await verify(context)).status, "passed");
  await writeFile(join(context.root, "gateway/github_token"), "");
  await assert.rejects(verify(context), { code: "AUTH_NOT_SAVED" });
  await writeFile(join(context.root, "gateway/github_token"), "synthetic-authorization");
  await writeFile(join(context.codexHome, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "synthetic-wrong-key" }));
  const script = resolve(ROOT, "skills/codex-copilot-gateway/scripts/verify.mjs");
  await assert.rejects(execute(process.execPath, [script, "--root", context.root, "--codex-home", context.codexHome]), error => {
    assert.equal(JSON.parse(error.stderr).code, "CLIENT_KEY_MISMATCH");
    for (const value of [...context.config.auth.apiKeys, context.config.auth.adminApiKey, "synthetic-wrong-key"]) {
      assert.ok(!error.stderr.includes(value) && !error.stdout.includes(value));
    }
    return true;
  });
  await writeFile(join(context.codexHome, "auth.json"), '{"OPENAI_API_KEY":"synthetic-private-fragment"');
  await assert.rejects(execute(process.execPath, [script, "--root", context.root, "--codex-home", context.codexHome]), error => {
    assert.equal(JSON.parse(error.stderr).code, "INVALID_JSON");
    assert.ok(!error.stderr.includes("synthetic-private-fragment"));
    return true;
  });
});

test("live requests need explicit approval and never accept a non-loopback credential destination", async () => {
  await assert.rejects(verify({ mode: "live" }), { code: "PAID_PROBE_NOT_APPROVED" });
  for (const url of ["https://example.com", "http://127.0.0.1@example.com", "http://127.0.0.1/path", "http://127.0.0.1/?redirect=x"]) {
    assert.throws(() => localOrigin(url), { code: "NONLOCAL_ORIGIN" });
  }
});

test("SSE success requires a real terminal event and exact marker, with no failure event", () => {
  const complete = `data: ${JSON.stringify({ type: "response.completed", response: { output: [{ content: [{ type: "output_text", text: "CODEX_PROXY_OK" }] }] } })}\n\n`;
  completedMarker(complete);
  assert.throws(() => completedMarker('data: {"type":"response.output_text.delta","delta":"CODEX_PROXY_OK"}\n\n'), { code: "MISSING_COMPLETION" });
  assert.throws(() => completedMarker(complete + 'data: {"type":"response.failed"}\n\n'), { code: "UPSTREAM_FAILURE" });
  assert.throws(() => completedMarker(complete.replace("CODEX_PROXY_OK", "not the marker")), { code: "OUTPUT_MISMATCH" });
});

test("catalog and live phases validate real HTTP shapes against a synthetic loopback server", async t => {
  const context = await fixture(t);
  let inferenceRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/") { response.end("Server running"); return; }
    if (request.headers.authorization !== `Bearer ${context.config.auth.apiKeys[0]}`) {
      response.writeHead(401).end(); return;
    }
    if (request.url === "/v1/responses") {
      inferenceRequests++;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"CODEX_PROXY_OK"}]}]}}\n\n');
      return;
    }
    response.setHeader("content-type", "application/json");
    const models = [{ slug: "gpt-6-astra", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] }];
    response.end(JSON.stringify(request.url === "/models" ? { models } : { data: [{ id: "gpt-6-astra" }] }));
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(() => new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const catalog = await verify({ ...context, baseUrl, mode: "catalog" });
  assert.equal(catalog.checks.model_catalogs, "passed");
  assert.equal(inferenceRequests, 0);
  await assert.rejects(verify({ ...context, baseUrl, mode: "catalog", effort: "unsupported" }), { code: "EFFORT_UNAVAILABLE" });
  const live = await verify({ ...context, baseUrl, mode: "live", allowPaidRequest: true });
  assert.equal(live.checks.response_completed_marker, "passed");
  assert.equal(inferenceRequests, 1);
  assert.ok(live.not_tested.includes("vscode_ui"));
});
