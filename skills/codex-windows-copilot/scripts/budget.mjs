// Optional, private, fail-closed quota ledger for explicitly bounded live probes.
// Reserve BEFORE forwarding; a failed/cancelled request still consumes its slot.
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export function readBudget(path) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Invalid budget path.");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema_version !== 1 || !Number.isSafeInteger(value.limit) ||
      value.limit < 1 || value.limit > 1000 || !Number.isSafeInteger(value.used) ||
      value.used < 0 || value.used > value.limit) throw new Error("Invalid budget ledger.");
  return value;
}

export function reserveRequest(path) {
  const lock = path + ".lock";
  const descriptor = openSync(lock, "wx"); // Never remove another owner's lock.
  let temporary;
  try {
    const state = readBudget(path);
    if (state.used >= state.limit) return false;
    temporary = path + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, JSON.stringify({ ...state, used: state.used + 1 }) + "\n", { flag: "wx" });
    renameSync(temporary, path);
    temporary = undefined;
    return true;
  } finally {
    closeSync(descriptor);
    if (temporary) {
      try { unlinkSync(temporary); } catch { /* Retain uncertain private state, never forward. */ }
    }
    unlinkSync(lock);
  }
}
