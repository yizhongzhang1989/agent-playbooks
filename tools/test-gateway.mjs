import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT } from "./lib.mjs";
import { createGatewayConfig } from "../skills/codex-copilot-gateway/scripts/create-gateway-config.mjs";
import { createPrivateDirectory } from "../skills/codex-copilot-gateway/scripts/common.mjs";

const execute = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm run test:gateway so the selected npm CLI is explicit.");
const target = await mkdtemp(join(tmpdir(), "agent-playbooks-gateway-"));
try {
  await cp(resolve(ROOT, "skills/codex-copilot-gateway/tools"), join(target, "tools"), {
    recursive: true,
    filter: path => !path.split(/[\\/]/).includes("node_modules"),
  });
  await createPrivateDirectory(join(target, "gateway"));
  await createGatewayConfig(target);
  const installed = await execute(process.execPath, [npmCli, "ci", "--prefix", join(target, "tools"), "--no-audit", "--no-fund"], {
    timeout: 180000, maxBuffer: 4 * 1024 * 1024,
  });
  process.stderr.write(installed.stdout);
  process.stderr.write(installed.stderr);
  const tested = await execute(process.execPath, ["--test", join(target, "tools/test/replication.test.mjs")], {
    timeout: 30000, maxBuffer: 1024 * 1024,
  });
  process.stderr.write(tested.stdout);
  process.stderr.write(tested.stderr);
  console.log(JSON.stringify({ status: "passed", check: "clean_locked_install_and_four_original_tests", real_credentials: false, model_calls: 0 }));
} catch (error) {
  process.stderr.write(error.stdout ?? "");
  process.stderr.write(error.stderr ?? "");
  throw error;
} finally {
  await rm(target, { recursive: true, force: true });
}
