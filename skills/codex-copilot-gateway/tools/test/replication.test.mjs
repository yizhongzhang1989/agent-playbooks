import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCodexResponsesError } from "../node_modules/@jeffreycao/copilot-api/dist/codex-responses-error.js";

test("upstream errors become explicit failures without losing their details", () => {
  const error = {
    code: "rate_limit_exceeded",
    message: "Synthetic rate-limit failure",
    type: "rate_limit_error",
    retry_after: 11,
  };
  const event = { type: "error", error, sequence_number: 7 };
  const chunk = { event: "error", data: JSON.stringify(event), id: "fixture" };
  const result = normalizeCodexResponsesError(chunk, event);
  assert.equal(result.event, "response.failed");
  assert.equal(result.id, "fixture");
  assert.deepEqual(JSON.parse(result.data), {
    type: "response.failed",
    sequence_number: 7,
    response: { status: "failed", error },
  });
  assert.ok(!result.data.includes("response.completed"));
});

test("normal and already-terminal events remain unchanged", () => {
  for (const type of ["response.created", "response.output_text.delta",
    "response.completed", "response.failed", "response.incomplete"]) {
    const event = { type };
    const chunk = { event: type, data: JSON.stringify(event) };
    assert.strictEqual(normalizeCodexResponsesError(chunk, event), chunk);
  }
});

test("flat failures retain their real message", () => {
  const event = { type: "error", code: null, message: "Synthetic connection lost" };
  const result = normalizeCodexResponsesError({ data: JSON.stringify(event) }, event);
  const parsed = JSON.parse(result.data);
  assert.equal(parsed.response.status, "failed");
  assert.equal(parsed.response.error.code, "upstream_error");
  assert.equal(parsed.response.error.message, event.message);
});

test("gateway transport and authentication match the replication requirements", async () => {
  const config = JSON.parse(await readFile(new URL("../../gateway/config.json", import.meta.url), "utf8"));
  assert.equal(config.useResponsesApiWebSocket, false);
  assert.equal(config.contextManagement.responses, false);
  assert.ok(Array.isArray(config.auth.apiKeys) && config.auth.apiKeys.length > 0);
  assert.ok(config.auth.apiKeys.every(key => typeof key === "string" && key.length > 0));
  assert.ok(typeof config.auth.adminApiKey === "string" && config.auth.adminApiKey.length > 0);
  assert.ok(!config.auth.apiKeys.includes(config.auth.adminApiKey));
});
