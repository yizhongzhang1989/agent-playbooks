import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import { ROOT, catalogRecords, loadSkills, parseSkill, readJson, resourcePath } from "../tools/lib.mjs";
import { findSkills } from "../tools/find.mjs";

const records = catalogRecords(await loadSkills());

test("discovery finds task and failure aliases, without offering unrelated tasks", () => {
  for (const query of ["Codex 插件无法连接", "stream closed before response.completed", "只看到 Chat", "配置 copilot-gateway", "UND_ERR_CONNECT_TIMEOUT", "插件找不到模型", "流提前结束"]) {
    assert.equal(findSkills(records, query)[0]?.id, "codex-copilot-gateway");
  }
  for (const query of ["整理会议纪要", "配置 Nginx HTTP 正向代理", "configure payment gateway", "mycodexhelper", "ENOTFOUND_OTHER"]) assert.deepEqual(findSkills(records, query), []);
  const many = Array.from({ length: 8 }, (_, index) => ({ ...records[0], id: `codex-example-${index}` }));
  assert.equal(findSkills(many, "codex").length, 5);
  assert.deepEqual(findSkills([{ ...records[0], lifecycle: "deprecated" }], "codex"), []);
});

test("frontmatter rejects mismatched identity and non-string metadata", () => {
  assert.throws(() => parseSkill("---\nname: wrong\ndescription: test\n---\n", "expected"), /mismatched name/);
  assert.throws(() => parseSkill("---\nname: example\ndescription: test\nmetadata:\n  version: 1\n---\n", "example"), /metadata values/);
});

test("resource references cannot escape the skill through traversal or symlinks", async t => {
  const temp = await mkdtemp(join(tmpdir(), "playbook-path-test-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(join(temp, "skill"));
  await writeFile(join(temp, "outside.txt"), "synthetic");
  await symlink(join(temp, "outside.txt"), join(temp, "skill/escape"));
  await assert.rejects(resourcePath(join(temp, "skill"), "../outside.txt"), /Invalid relative resource/);
  await assert.rejects(resourcePath(join(temp, "skill"), "escape"), /escapes/);
});

test("successful outcomes require every operation-specific acceptance item", async () => {
  const ajv = new Ajv({ strict: true });
  const contract = await readJson(resolve(ROOT, "skills/codex-copilot-gateway/contract.json"));
  const validate = ajv.compile(contract.output_schema);
  const checks = Object.fromEntries(contract.operations.find(operation => operation.id === "verify").required_acceptance.map(id => [id, "passed"]));
  assert.equal(validate({ operation: "verify", status: "succeeded", checks, remaining: [] }), true);
  const { A_UI, ...withoutUi } = checks;
  assert.equal(validate({ operation: "verify", status: "succeeded", checks: withoutUi, remaining: [] }), false);
  assert.equal(validate({ operation: "verify", status: "succeeded", checks: { ...checks, A_UI: "not_tested" }, remaining: [] }), false);
  assert.equal(validate({ operation: "verify", status: "waiting_for_user", checks: { ...checks, A_UI: "not_tested" }, remaining: ["UI confirmation"] }), true);
});

test("private run records cannot claim success with an untested requirement", async () => {
  const validate = new Ajv({ strict: true }).compile(await readJson(resolve(ROOT, "schemas/run.schema.json")));
  const run = {
    schema_version: 1, run_id: "synthetic", skill_id: "codex-copilot-gateway",
    skill_revision: `sha256:${"a".repeat(64)}`, operation: "verify", status: "succeeded",
    context: { target: "synthetic-target", environment: "synthetic-environment" },
    feedback: { status: "none", summary: "No new reusable observation", finding_ids: [] },
    completed_steps: ["S10"], pending_step: null, required_checks: { ui: "not_tested" },
    artifact_refs: [], resume_checks: ["extension_version"],
  };
  assert.equal(validate(run), false);
  assert.equal(validate({ ...run, status: "waiting_for_user", pending_step: "S50" }), true);
});

test("bootstrap version stays consistent with the maintained version metadata", async () => {
  const skill = resolve(ROOT, "skills/codex-copilot-gateway");
  const versions = await readJson(join(skill, "versions.json"));
  const install = await readFile(join(skill, "references/install.md"), "utf8");
  assert.ok(install.includes(`NODE_VERSION=v${versions.node}`));
});
