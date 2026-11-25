import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, catalogRecords, catalogText, loadSkills, readmeText } from "./lib.mjs";

const records = catalogRecords(await loadSkills());
await writeFile(resolve(ROOT, "catalog.jsonl"), catalogText(records));
await writeFile(resolve(ROOT, "README.md"), readmeText(records));
console.log(JSON.stringify({ status: "passed", generated: ["catalog.jsonl", "README.md"], skills: records.length }));
