import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkRun } from "../tools/check-run.mjs";
import { findSkills } from "../tools/find.mjs";
import { catalogRecords } from "../tools/lib.mjs";
import { skillRevision, validateMaintenance } from "../tools/maintenance.mjs";

const json = (path, value) => writeFile(path, JSON.stringify(value));

async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), "playbook-maintenance-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await mkdir(join(path, "evidence"));
  await writeFile(join(path, "procedure.md"), "original procedure");
  await json(join(path, "findings.json"), { schema_version: 1, findings: [] });
  const evidence = {
    id: "original", date: "2026-11-25", scope: "repository_offline",
    environment: { platform: "synthetic" },
    material_hashes: { "procedure.md": createHash("sha256").update("original procedure").digest("hex") },
    checks: [{ id: "A_CHECK", result: "passed", method: "offline", source_refs: ["synthetic"], detail: "Synthetic only" }],
    limitations: ["No live verification"],
  };
  await json(join(path, "evidence/original.json"), evidence);
  return {
    id: "example", path, findings: [], metadata: { description: "Synthetic fixture" }, evidence: [],
    contract: {
      lifecycle: "active", tags: [], aliases: ["fixture"], use_when: [], avoid_when: [],
      dependencies: { platform: "synthetic" },
      operations: [{ id: "verify", required_acceptance: ["A_CHECK", "A_UI"] }],
      acceptance: { A_CHECK: {}, A_UI: {} },
      evidence: { current: ["evidence/original.json"], historical: [] },
    },
  };
}

const sources = new Set(["synthetic"]);
const finding = {
  id: "new-failure", kind: "problem", status: "open", summary: "A synthetic failure",
  observed_on: "2026-11-25", applies_to: ["synthetic environment"], operations: ["verify"],
  blocking: true, aliases: ["EXAMPLE_FAILURE"], source_refs: ["synthetic"],
};

test("material upgrades preserve historical evidence and require new current evidence for active use", async t => {
  const skill = await fixture(t);
  await validateMaintenance(skill, sources);
  const original = await readFile(join(skill.path, "evidence/original.json"), "utf8");
  await writeFile(join(skill.path, "procedure.md"), "corrected procedure");
  await assert.rejects(validateMaintenance(skill, sources), /current evidence material changed/);
  skill.contract.evidence = { current: [], historical: ["evidence/original.json"] };
  await assert.rejects(validateMaintenance(skill, sources), /active skill needs current evidence/);
  skill.contract.lifecycle = "stale";
  await validateMaintenance(skill, sources);
  const updated = JSON.parse(original);
  updated.id = "updated";
  updated.material_hashes["procedure.md"] = createHash("sha256").update("corrected procedure").digest("hex");
  await json(join(skill.path, "evidence/updated.json"), updated);
  await assert.rejects(validateMaintenance(skill, sources), /classified exactly once/);
  skill.contract.evidence.current.push("evidence/updated.json");
  skill.contract.lifecycle = "active";
  await validateMaintenance(skill, sources);
  assert.equal(await readFile(join(skill.path, "evidence/original.json"), "utf8"), original);
  skill.contract.evidence.historical.push("evidence/updated.json");
  await assert.rejects(validateMaintenance(skill, sources), /both current and historical/);
});

test("blocking findings force review; closure needs supported resolution and valid references", async t => {
  const skill = await fixture(t);
  const save = value => json(join(skill.path, "findings.json"), { schema_version: 1, findings: [value] });
  await save(finding);
  await assert.rejects(validateMaintenance(skill, sources), /blocking open finding/);
  skill.contract.lifecycle = "stale";
  await validateMaintenance(skill, sources);
  await save({ ...finding, status: "resolved" });
  await assert.rejects(validateMaintenance(skill, sources), /findings schema/);
  const resolved = { ...finding, status: "resolved", resolution: {
    reason: "Corrected the synthetic procedure", resources: ["procedure.md"],
    verification: [{ method: "offline", result: "passed", detail: "Synthetic regression only; UI remains untested" }],
  } };
  await save(resolved);
  skill.contract.lifecycle = "active";
  await validateMaintenance(skill, sources);
  await save({ ...resolved, source_refs: ["missing"] });
  await assert.rejects(validateMaintenance(skill, sources), /unknown finding source/);
  await save({ ...resolved, operations: ["nonexistent"] });
  await assert.rejects(validateMaintenance(skill, sources), /unknown finding operation/);
  await save({ ...resolved, resolution: { ...resolved.resolution, resources: ["../outside.md"] } });
  await assert.rejects(validateMaintenance(skill, sources), /Invalid relative resource/);
});

test("findings are discoverable and stale candidates retain scope and blocking information", async t => {
  const skill = await fixture(t);
  skill.findings = [finding];
  skill.contract.lifecycle = "stale";
  const [match] = findSkills(catalogRecords([skill]), "收到 EXAMPLE_FAILURE");
  assert.equal(match.id, "example");
  assert.equal(match.lifecycle, "stale");
  assert.equal(match.open_findings[0].blocking, true);
  assert.equal(match.platform, "synthetic");
  assert.deepEqual(findSkills(catalogRecords([skill]), "EXAMPLE_FAILURE_SUFFIX"), []);
});

test("resume checks bind private state to package content and the full operation acceptance", async t => {
  const skill = await fixture(t);
  const run = {
    schema_version: 1, run_id: "synthetic", skill_id: "example",
    skill_revision: await skillRevision(skill.path), operation: "verify", status: "succeeded",
    context: { target: "private synthetic target", environment: "synthetic" },
    completed_steps: ["verify"], pending_step: null,
    required_checks: { A_CHECK: "passed", A_UI: "passed" }, artifact_refs: [],
    resume_checks: ["Check actual environment again"],
    feedback: { status: "pending", summary: "Observation awaits sanitization", finding_ids: [] },
  };
  assert.equal((await checkRun(run, [skill])).feedback_pending, true);
  await assert.rejects(checkRun({ ...run, required_checks: { A_CHECK: "passed" } }, [skill]), /operation-specific/);
  await assert.rejects(checkRun({ ...run, required_checks: { A_CHECK: "passed", A_UI: "not_tested" } }, [skill]), /Invalid private run/);
  await assert.rejects(checkRun({ ...run, operation: "unknown" }, [skill]), /unknown operation/);
  await assert.rejects(checkRun({ ...run, feedback: { status: "recorded", summary: "Saved", finding_ids: ["unknown"] } }, [skill]), /unknown finding/);
  await writeFile(join(skill.path, "procedure.md"), "changed since interruption");
  await assert.rejects(checkRun(run, [skill]), /Skill changed/);
  assert.notEqual(await skillRevision(skill.path), run.skill_revision);
});

test("draft skills can begin without evidence or an evidence directory", async t => {
  const skill = await fixture(t);
  await rm(join(skill.path, "evidence"), { recursive: true });
  skill.contract.evidence = { current: [], historical: [] };
  skill.contract.lifecycle = "draft";
  await validateMaintenance(skill, sources);
});
