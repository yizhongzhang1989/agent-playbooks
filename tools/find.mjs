import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, isMain, requireCondition } from "./lib.mjs";

function includesAnchor(query, anchor) {
  const normalized = anchor.normalize("NFKC").toLowerCase().trim();
  if (!normalized) return false;
  // Error codes and English names match tokens, not incidental substrings
  // (e.g. "decode" must not match "code"). Chinese phrases remain contiguous.
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^[a-z0-9_]/.test(normalized) ? "(?<![a-z0-9_])" : "";
  const right = /[a-z0-9_]$/.test(normalized) ? "(?![a-z0-9_])" : "";
  return new RegExp(left + escaped + right, "u").test(query);
}

export function findSkills(records, query, limit = 5) {
  const normalized = query.normalize("NFKC").toLowerCase().trim();
  requireCondition(normalized.length > 0, "Provide a nonempty task or symptom");
  requireCondition(Number.isInteger(limit) && limit >= 1 && limit <= 5, "Limit must be between 1 and 5");
  return records.flatMap(record => {
    if (record.lifecycle === "deprecated") return [];
    const anchors = [record.id, ...record.aliases, ...(record.finding_aliases ?? [])];
    const reasons = [...new Set(anchors.filter(anchor => includesAnchor(normalized, anchor)))];
    if (reasons.length === 0) return [];
    return [{ ...record, score: reasons.reduce((sum, reason) => sum + reason.length, 0), reasons }];
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en")).slice(0, limit);
}

if (isMain(import.meta.url)) {
  try {
    const query = process.argv.slice(2).join(" ");
    const lines = (await readFile(resolve(ROOT, "catalog.jsonl"), "utf8")).trim().split("\n");
    const matches = findSkills(lines.map(line => JSON.parse(line)), query);
    console.log(JSON.stringify({ status: matches.length ? "matched" : "no_match", matches,
      next: matches.length ? "Read the contract, open findings and applicable operation; candidates do not authorize execution."
        : "Try a product name, exact error code or inspect catalog.jsonl; no match does not prove a missing skill.",
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
