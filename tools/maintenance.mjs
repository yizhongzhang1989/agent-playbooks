import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { ROOT, listFiles, readJson, requireCondition, resourcePath } from "./lib.mjs";

const ajv = new Ajv({ allErrors: true, strict: true });
const evidenceCheck = ajv.compile(await readJson(resolve(ROOT, "schemas/evidence.schema.json")));
const findingsCheck = ajv.compile(await readJson(resolve(ROOT, "schemas/findings.schema.json")));

export async function skillRevision(path) {
  const hash = createHash("sha256");
  for (const file of await listFiles(path)) {
    // Hash each file first so content containing delimiters cannot create ambiguity.
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    hash.update(JSON.stringify([relative(path, file).split("\\").join("/"), digest]) + "\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function validateMaintenance({ id, path, contract }, sourceIds) {
  const document = await readJson(resolve(path, "findings.json"));
  requireCondition(findingsCheck(document), `${id}: findings schema: ${ajv.errorsText(findingsCheck.errors)}`);
  const findings = document.findings;
  requireCondition(new Set(findings.map(finding => finding.id)).size === findings.length, `${id}: duplicate finding ID`);
  const operations = new Set(contract.operations.map(operation => operation.id));
  for (const finding of findings) {
    for (const operation of finding.operations) requireCondition(operations.has(operation), `${id}: unknown finding operation ${operation}`);
    for (const source of finding.source_refs) requireCondition(sourceIds.has(source), `${id}: unknown finding source ${source}`);
    requireCondition(!(contract.lifecycle === "active" && finding.status === "open" && finding.blocking), `${id}: blocking open finding requires stale/draft/deprecated lifecycle`);
    for (const resource of finding.resolution?.resources ?? []) await resourcePath(path, resource);
  }

  const { current, historical } = contract.evidence;
  const selected = [...current, ...historical];
  requireCondition(new Set(selected).size === selected.length, `${id}: evidence cannot be both current and historical`);
  const files = (await readdir(resolve(path, "evidence")).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).map(name => `evidence/${name}`).sort();
  requireCondition(JSON.stringify([...selected].sort()) === JSON.stringify(files), `${id}: every evidence file must be classified exactly once`);
  requireCondition(contract.lifecycle !== "active" || current.length > 0, `${id}: active skill needs current evidence`);
  const evidenceIds = new Set();
  for (const resource of selected) {
    const evidence = await readJson(await resourcePath(path, resource));
    requireCondition(evidenceCheck(evidence), `${id}: evidence schema: ${ajv.errorsText(evidenceCheck.errors)}`);
    requireCondition(!evidenceIds.has(evidence.id), `${id}: duplicate evidence ID`);
    evidenceIds.add(evidence.id);
    requireCondition(new Set(evidence.checks.map(check => check.id)).size === evidence.checks.length, `${id}: duplicate evidence check`);
    for (const check of evidence.checks) {
      // Old acceptance IDs may have been retired. Sources stay available for provenance.
      if (current.includes(resource)) requireCondition(check.id in contract.acceptance, `${id}: unknown evidence check ${check.id}`);
      for (const ref of check.source_refs) requireCondition(sourceIds.has(ref), `${id}: unknown source ${ref}`);
    }
    for (const [material, hash] of Object.entries(evidence.material_hashes)) {
      requireCondition(!material.startsWith("/") && !material.includes("\\") && !material.split("/").includes(".."), `${id}: invalid evidence material path`);
      // Historical evidence describes old bytes, which may no longer be present.
      if (historical.includes(resource)) continue;
      const actual = createHash("sha256").update(await readFile(await resourcePath(path, material))).digest("hex");
      requireCondition(actual === hash, `${id}: current evidence material changed: ${material}; archive the old record and revalidate`);
    }
  }
}
