import { randomBytes } from "node:crypto";
import { lstat, realpath, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { absolutePath, check, cli, isMain, readPrivateJson } from "./common.mjs";

export async function createGatewayConfig(root) {
  const target = await realpath(absolutePath(root));
  const skill = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  check(target !== skill && !target.startsWith(skill + sep), "RUNTIME_IN_SKILL", "Runtime credentials must not be written inside the skill package.");
  for (let directory = skill; ; directory = dirname(directory)) {
    try {
      await lstat(join(directory, ".git"));
      check(target !== directory && !target.startsWith(directory + sep), "RUNTIME_IN_REPOSITORY", "Runtime credentials must not be written inside the source repository.");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (dirname(directory) === directory) break;
  }
  const gateway = await lstat(join(target, "gateway"));
  check(gateway.isDirectory() && !gateway.isSymbolicLink() && (gateway.mode & 0o777) === 0o700,
    "UNSAFE_GATEWAY_DIRECTORY", "Create a private mode-700 gateway directory, not a symlink.");
  const config = await readPrivateJson(new URL("../assets/templates/gateway.config.example.json", import.meta.url), "Gateway template");
  check(config.auth.apiKeys.length === 0 && config.auth.adminApiKey === "", "NONEMPTY_TEMPLATE", "The source template must not contain credentials.");
  config.auth.apiKeys = ["local-" + randomBytes(32).toString("hex")];
  config.auth.adminApiKey = "admin-" + randomBytes(32).toString("hex");
  await writeFile(join(target, "gateway/config.json"), JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { status: "passed", check: "gateway_config_created", credentials_printed: false };
}

if (isMain(import.meta.url)) {
  await cli(async () => {
    const { values } = parseArgs({ options: { root: { type: "string" } } });
    return createGatewayConfig(values.root);
  });
}
