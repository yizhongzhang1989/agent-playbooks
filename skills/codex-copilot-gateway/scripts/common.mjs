import { execFile } from "node:child_process";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function check(condition, code, message) {
  if (!condition) throw new ProbeError(code, message);
}

export function absolutePath(path) {
  check(typeof path === "string" && isAbsolute(path), "INVALID_PATH", "Provide an explicit absolute path.");
  return resolve(path);
}

export async function readPrivateJson(path, label) {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ProbeError("INVALID_JSON", `${label} is not valid JSON; inspect it privately.`);
  }
}

async function windowsAcl(path, action = "Check") {
  check(typeof process.env.SystemRoot === "string" && isAbsolute(process.env.SystemRoot),
    "WINDOWS_POWERSHELL_UNAVAILABLE", "Windows SystemRoot is required for ACL verification.");
  const executable = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = fileURLToPath(new URL("./windows-acl.ps1", import.meta.url));
  const { stdout } = await execute(executable, ["-NoProfile", "-NonInteractive", "-File", script, "-Action", action, "-Path", absolutePath(path)], {
    timeout: 15000, maxBuffer: 65536, windowsHide: true,
  });
  check(stdout.trim() === "private", "UNSAFE_PERMISSIONS",
    "Windows private paths must be owned by the current user or SYSTEM and allow access only to those identities.");
}

export async function createPrivateDirectory(path) {
  const target = absolutePath(path);
  if (process.platform === "win32") await windowsAcl(target, "CreateDirectory");
  else await mkdir(target, { mode: 0o700 });
}

export async function privateDirectory(path) {
  const info = await lstat(path);
  check(info.isDirectory() && !info.isSymbolicLink(), "UNSAFE_GATEWAY_DIRECTORY", "Expected a private directory, not a symlink.");
  if (process.platform === "win32") await windowsAcl(path);
  else check((info.mode & 0o777) === 0o700, "UNSAFE_GATEWAY_DIRECTORY", "Private directories must have mode 700.");
  return info;
}

export async function privateFile(path) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink(), "INVALID_PRIVATE_FILE", "Expected a regular private file, not a symlink.");
  if (process.platform === "win32") await windowsAcl(path);
  else check((info.mode & 0o777) === 0o600, "UNSAFE_PERMISSIONS", "Private files must have mode 600.");
  return info;
}

export function validateGateway(config) {
  const keys = config?.auth?.apiKeys;
  check(Array.isArray(keys) && keys.length > 0 && keys.every(key => typeof key === "string" && key.length > 0),
    "MISSING_CLIENT_KEY", "Gateway ordinary API keys are missing.");
  check(typeof config.auth.adminApiKey === "string" && config.auth.adminApiKey.length > 0 && !keys.includes(config.auth.adminApiKey),
    "INVALID_ADMIN_KEY", "Gateway management key must exist and differ from ordinary keys.");
  check(config.useResponsesApiWebSocket === false && config.contextManagement?.responses === false,
    "TRANSPORT_MISMATCH", "Gateway transport differs from the reference HTTP/SSE configuration.");
  return keys[0];
}

export function isMain(url) {
  return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);
}

export async function cli(action) {
  try {
    console.log(JSON.stringify(await action()));
  } catch (error) {
    const code = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "CHECK_FAILED";
    console.error(JSON.stringify({
      status: "failed",
      code,
      message: error instanceof ProbeError ? error.message : "Operation failed; inspect the local environment. Private values were not printed.",
    }));
    process.exitCode = 1;
  }
}
