import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import {
  ROOT, catalogRecords, catalogText, checkMarkdownLinks, listFiles,
  loadSkills, readJson, readmeText, requireCondition, resourcePath,
} from "./lib.mjs";
import { validateMaintenance } from "./maintenance.mjs";

const ajv = new Ajv({ allErrors: true, strict: true });
const contractCheck = ajv.compile(await readJson(resolve(ROOT, "schemas/contract.schema.json")));
ajv.compile(await readJson(resolve(ROOT, "schemas/run.schema.json")));
const skills = await loadSkills();

for (const skill of skills) {
  const { id, path, contract } = skill;
  requireCondition(contractCheck(contract), `${id}: contract schema: ${ajv.errorsText(contractCheck.errors)}`);
  requireCondition(contract.id === id, `${id}: contract identity mismatch`);
  ajv.compile(contract.input_schema);
  ajv.compile(contract.output_schema);
  const operations = contract.operations.map(operation => operation.id);
  requireCondition(new Set(operations).size === operations.length, `${id}: duplicate operation`);
  requireCondition(JSON.stringify(operations) === JSON.stringify(contract.input_schema.properties.operation.enum), `${id}: operation input enum differs from routes`);
  for (const operation of contract.operations) {
    await resourcePath(path, operation.entrypoint);
    for (const check of operation.required_acceptance) requireCondition(check in contract.acceptance, `${id}: unknown acceptance ${check}`);
  }
  for (const resource of contract.resources) await resourcePath(path, resource);
  const sources = await readJson(resolve(path, "sources.json"));
  requireCondition(Array.isArray(sources.sources) && sources.sources.length > 0, `${id}: missing sources`);
  const sourceIds = new Set(sources.sources.map(source => source.id));
  requireCondition(sourceIds.size === sources.sources.length && [...sourceIds].every(value => typeof value === "string" && value.length > 0), `${id}: invalid source IDs`);
  await validateMaintenance(skill, sourceIds);
  for (const file of await listFiles(path)) {
    if (file.endsWith(".md")) await checkMarkdownLinks(file, path);
  }
  if (contract.resources.includes("tools/package.json")) {
    const manifest = await readJson(resolve(path, "tools/package.json"));
    const lock = await readJson(resolve(path, "tools/package-lock.json"));
    requireCondition(JSON.stringify(manifest.dependencies) === JSON.stringify(lock.packages[""].dependencies), `${id}: runtime manifest/lock mismatch`);
  }
}

for (const file of await listFiles(ROOT)) {
  const name = relative(ROOT, file);
  requireCondition(!["auth.json", "github_token"].includes(basename(file)) && !/\.(sqlite(?:-.*)?|log)$/.test(file), `Runtime/private file in source tree: ${name}`);
  const text = await readFile(file, "utf8");
  requireCondition(!/(?:gh[pousr]_[A-Za-z0-9]{20,}|(?:local|admin)-[a-f0-9]{64})/.test(text), `Possible credential in ${name}`);
  if (file.endsWith(".mjs")) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    requireCondition(result.status === 0, `JavaScript syntax failure: ${name}\n${result.stderr}`);
  }
  if (file.endsWith(".sh")) {
    const result = spawnSync("bash", ["-n"], { input: text, encoding: "utf8" });
    requireCondition(result.status === 0, `Shell syntax failure: ${name}\n${result.stderr}`);
  }
  if (file.endsWith(".md")) {
    await checkMarkdownLinks(file, ROOT);
    const lines = text.split("\n");
    let fence = null;
    let code = [];
    for (const line of lines) {
      const marker = line.match(/^```([^`]*)$/);
      if (!marker) { if (fence !== null) code.push(line); continue; }
      if (fence === null) { fence = marker[1].trim(); code = []; continue; }
      requireCondition(marker[1] === "", `Nested Markdown fence: ${name}`);
      if (fence === "bash") {
        const result = spawnSync("bash", ["-n"], { input: code.join("\n"), encoding: "utf8" });
        requireCondition(result.status === 0, `Documented shell syntax failure: ${name}\n${result.stderr}`);
      }
      fence = null;
    }
    requireCondition(fence === null, `Unclosed Markdown fence: ${name}`);
  }
}

const records = catalogRecords(skills);
requireCondition(await readFile(resolve(ROOT, "catalog.jsonl"), "utf8") === catalogText(records), "Catalog drift: run npm run catalog");
requireCondition(await readFile(resolve(ROOT, "README.md"), "utf8") === readmeText(records), "README drift: run npm run catalog");
await checkMarkdownLinks(resolve(ROOT, "README.md"), ROOT);
console.log(JSON.stringify({ status: "passed", skills: skills.length, checks: ["schemas", "frontmatter", "references", "current_evidence_hashes", "findings", "syntax", "generated_files", "credential_patterns"] }));
