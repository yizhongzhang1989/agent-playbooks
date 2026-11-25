import { isAbsolute, resolve } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { ROOT, isMain, loadSkills, readJson, requireCondition } from "./lib.mjs";
import { skillRevision } from "./maintenance.mjs";

const ajv = new Ajv({ allErrors: true, strict: true });
const runCheck = ajv.compile(await readJson(resolve(ROOT, "schemas/run.schema.json")));

export async function checkRun(run, skills) {
  // Do not echo private record values or schema instance data into console output.
  requireCondition(runCheck(run), "Invalid private run record; check schemas/run.schema.json locally");
  const skill = skills.find(item => item.id === run.skill_id);
  requireCondition(skill, "Run refers to an unknown skill");
  const operation = skill.contract.operations.find(item => item.id === run.operation);
  requireCondition(operation, "Run refers to an unknown operation");
  const revision = await skillRevision(skill.path);
  requireCondition(run.skill_revision === revision, "Skill changed since this run; review the diff and resume checks before recording the new revision");
  for (const id of Object.keys(run.required_checks)) requireCondition(id in skill.contract.acceptance, "Run contains an unknown acceptance check");
  for (const id of operation.required_acceptance) requireCondition(id in run.required_checks, "Run is missing an operation-specific acceptance check");
  if (run.status === "succeeded") {
    for (const id of operation.required_acceptance) requireCondition(run.required_checks[id] === "passed", "Run is missing a passed acceptance check");
  }
  for (const id of run.feedback.finding_ids) requireCondition(skill.findings.some(finding => finding.id === id), "Feedback refers to an unknown finding");
  return {
    status: "passed", check: "private_record_consistency", skill_id: skill.id,
    operation: operation.id, lifecycle: skill.contract.lifecycle,
    feedback_pending: run.feedback.status === "pending",
    resume_required: ["target_environment", "existing_configuration", "authorization_scope", "required_acceptance", "open_findings"],
    note: "Record consistency is not execution evidence or permission to resume. Recheck actual state before any write.",
  };
}

if (isMain(import.meta.url)) {
  try {
    const [option, value, ...extra] = process.argv.slice(2);
    const skills = await loadSkills();
    requireCondition(extra.length === 0, "Unexpected arguments");
    if (option === "--revision") {
      const skill = skills.find(item => item.id === value);
      requireCondition(skill, "Provide a known skill ID");
      console.log(await skillRevision(skill.path));
    } else {
      requireCondition(option === "--file" && typeof value === "string" && isAbsolute(value), "Use --file <absolute private run path> or --revision <skill-id>");
      const result = await checkRun(await readJson(value), skills);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch {
    console.error("Run check failed: inspect the record, skill revision, operation acceptance and feedback references locally. No private record was printed.");
    process.exitCode = 1;
  }
}
