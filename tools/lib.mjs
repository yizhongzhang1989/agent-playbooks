import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readJson(path) {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`Invalid JSON in ${path}`);
  }
}

export function parseSkill(text, id) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  requireCondition(match, `${id}: missing YAML frontmatter`);
  const metadata = parse(match[1], { uniqueKeys: true });
  requireCondition(metadata && typeof metadata === "object" && !Array.isArray(metadata), `${id}: invalid frontmatter`);
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const key of Object.keys(metadata)) requireCondition(allowed.has(key), `${id}: unsupported frontmatter field ${key}`);
  requireCondition(metadata.name === id && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64, `${id}: invalid or mismatched name`);
  requireCondition(typeof metadata.description === "string" && metadata.description.trim().length > 0 && metadata.description.length <= 1024, `${id}: invalid description`);
  for (const key of ["license", "compatibility", "allowed-tools"]) {
    if (metadata[key] !== undefined) requireCondition(typeof metadata[key] === "string" && metadata[key].length > 0, `${id}: ${key} must be a nonempty string`);
  }
  if (metadata.compatibility) requireCondition(metadata.compatibility.length <= 500, `${id}: compatibility is too long`);
  if (metadata.metadata !== undefined) {
    requireCondition(metadata.metadata && typeof metadata.metadata === "object" && !Array.isArray(metadata.metadata), `${id}: metadata must be a mapping`);
    requireCondition(Object.values(metadata.metadata).every(value => typeof value === "string"), `${id}: metadata values must be strings`);
  }
  requireCondition(text.split("\n").length <= 200, `${id}: move details out of the skill entrypoint`);
  return metadata;
}

export async function loadSkills(root = ROOT) {
  const entries = await readdir(resolve(root, "skills"), { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    requireCondition(entry.isDirectory(), `Unexpected skill entry: ${entry.name}`);
    const path = resolve(root, "skills", entry.name);
    const body = await readFile(resolve(path, "SKILL.md"), "utf8");
    const metadata = parseSkill(body, entry.name);
    const contract = await readJson(resolve(path, "contract.json"));
    const { findings } = await readJson(resolve(path, "findings.json"));
    const evidence = [];
    for (const resource of contract.evidence.current) {
      const { id, date, scope } = await readJson(await resourcePath(path, resource));
      evidence.push({ path: resource, id, date, scope });
    }
    skills.push({ id: entry.name, path, body, metadata, contract, findings, evidence });
  }
  requireCondition(skills.length > 0, "No skills found");
  return skills;
}

export async function resourcePath(root, path) {
  requireCondition(typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") && !path.split("/").includes(".."), `Invalid relative resource: ${path}`);
  const base = await realpath(root);
  const target = await realpath(resolve(root, path));
  requireCondition(target.startsWith(base + sep), `Resource escapes its package: ${path}`);
  requireCondition((await stat(target)).isFile(), `Resource is not a file: ${path}`);
  return target;
}

export async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    requireCondition(!entry.isSymbolicLink(), `Symlink is not a portable source file: ${entry.name}`);
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export function catalogRecords(skills) {
  return skills.map(({ id, metadata, contract, findings, evidence }) => ({
    id,
    description: metadata.description,
    lifecycle: contract.lifecycle,
    entrypoint: `skills/${id}/SKILL.md`,
    contract: `skills/${id}/contract.json`,
    tags: contract.tags,
    aliases: contract.aliases,
    use_when: contract.use_when,
    avoid_when: contract.avoid_when,
    operations: contract.operations.map(operation => operation.id),
    platform: contract.dependencies.platform,
    evidence,
    findings: `skills/${id}/findings.json`,
    open_findings: findings.filter(finding => finding.status === "open")
      .map(({ id, summary, operations, blocking }) => ({ id, summary, operations, blocking })),
    finding_aliases: findings.flatMap(finding => finding.aliases),
  }));
}

export function catalogText(records) {
  return records.map(record => JSON.stringify(record)).join("\n") + "\n";
}

export function readmeText(records) {
  const rows = records.map(record => `| [${record.id}](${record.entrypoint}) | ${record.lifecycle} | ${record.description.replaceAll("|", "\\|").replaceAll("\n", " ")} |`);
  return [
    "# agent-playbooks",
    "",
    "<!-- Generated by tools/build-catalog.mjs. Edit tools/lib.mjs for this guide or skill sources for catalog entries, then run npm run catalog. -->",
    "",
    "面向 AI 的复杂配置技能库：检索 → 判定适用性 → 按需执行 → 验证 → 反馈修正。",
    "先读 [AGENTS.md](AGENTS.md)。技能描述和契约不授予执行权限，也不代表客户端已自动注册技能。",
    "",
    "## 开始使用",
    "",
    "把仓库克隆或下载到 AI 客户端能读取的本地目录，并在对话中提供仓库的绝对路径、",
    "要完成的目标及目标环境。客户端需要文件读取能力；实际配置还需要目标机器上的操作能力。",
    "如果只有网页聊天能力，可以按下面的读取顺序提供相关文件，但聊天本身不会执行本机配置。",
    "",
    "最简单的用法是把下面这段话交给 AI；将 `/absolute/path/agent-playbooks` 换成实际路径：",
    "",
    "```text",
    "请使用 /absolute/path/agent-playbooks 中的技能帮助我诊断：",
    "本机 Ubuntu 22.04、普通本地 VS Code 的 Codex 插件无法连接，已有 Copilot 网关。",
    "先读 AGENTS.md 并检索 catalog.jsonl，再读匹配技能的 SKILL.md、contract.json、",
    "findings.json 和 diagnose 操作参考。先做只读诊断，报告失败层、依据和下一步。",
    "结束时检查是否有值得补充到技能中的新发现，未整理的发现保留为 pending 反馈。",
    "```",
    "",
    "使用已有技能不需要先安装仓库的 Node 依赖：AI 可以直接检索 JSONL 目录。",
    "仓库出现在磁盘上不等于已被客户端注册；可直接按路径读取，原生技能安装则遵循客户端的加载机制。",
    "",
    "## 手动检索和选择操作",
    "",
    "需要命令行检索时，准备 Node.js >=22.13.0（参考版本见 [.node-version](.node-version)）。",
    "以下命令在仓库根目录运行；示例路径需替换，并确保所选 Node/npm 已在本次 shell 的 PATH 中。",
    "",
    "```bash",
    "cd /absolute/path/agent-playbooks",
    "node --version",
    "npm ci --no-audit --no-fund",
    'node tools/find.mjs "Codex 插件无法连接"',
    'node tools/find.mjs "UND_ERR_CONNECT_TIMEOUT"',
    "```",
    "",
    "例如查询 `UND_ERR_CONNECT_TIMEOUT` 会返回 `codex-copilot-gateway` 候选及入口路径。",
    "检索只读取索引，不会安装或启动网关。依次进行：",
    "",
    "1. 查看候选的适用平台、生命周期、证据日期/范围和 `open_findings`。",
    "2. 读取对应 `SKILL.md`、`contract.json` 和 `findings.json`，确认适用条件与限制。",
    "3. 根据目标选择 operation，只读对应的 reference；已有故障通常先选 `diagnose`。",
    "4. 按实际环境和授权执行，逐项验收，报告已完成项、未验证项及新发现。",
    "",
    "检索使用技能名称、明确别名和错误码，不是语义搜索。返回 `no_match` 时换产品名或错误码，",
    "或直接查看 [catalog.jsonl](catalog.jsonl)，再决定是否需要新技能。",
    "",
    "## 使用示例",
    "",
    "以下提示词中的路径和环境都应按实际情况替换。",
    "",
    "### 示例一：在新机器上配置已有技能",
    "",
    "```text",
    "请使用 /absolute/path/agent-playbooks 为当前用户配置本地 Copilot 网关，",
    "让普通本地 VS Code 的 Codex 插件连接它。目标是 Ubuntu 22.04 x86_64，",
    "VS Code 已安装，这台机器还没有网关。先按 AGENTS.md 检索和检查适用性，",
    "再按 codex-copilot-gateway 的 install 操作执行。涉及账号授权、已有登录切换、",
    "服务影响和真实模型请求时按契约处理。最后报告各验收项及尚需我参与的步骤。",
    "```",
    "",
    "AI 应进入安装参考并先检查目标环境。CLI 探测通过不能代替实际 VS Code UI 验收；",
    "缺少 UI 证据时，应明确交接剩余步骤。上面的“开始使用”提示词则演示了已有部署的诊断。",
    "",
    "原生 Windows 请同时阅读 [Windows 补充](skills/codex-copilot-gateway/references/windows.md)，",
    "不要照搬 systemd、chmod 或 Linux 路径。当前 Windows 证据覆盖维护工具和已有代理的模型",
    "元数据恢复，不包含固定网关新装、真实推理、GUI 或重启验收；具体限制见该技能的 findings。",
    "PowerShell 中的维护命令使用 `npm.cmd`；仓库不会自动替换这台机器已有的代理或登录。",
    "",
    "### 示例二：中断后在新会话继续",
    "",
    "中断前，让 AI 按 [run schema](schemas/run.schema.json) 将实际进度保存在仓库外的私有 JSON，",
    "记录目标、环境、操作、已完成步骤、待执行步骤、验收结果、备份引用和反馈。",
    "在仓库根目录获取当时的技能内容版本，将输出保存为记录中的 `skill_revision`：",
    "",
    "```bash",
    "node tools/check-run.mjs --revision codex-copilot-gateway",
    "```",
    "",
    "新会话中可以这样交接：",
    "",
    "```text",
    "继续上次的网关配置。技能仓库在 /absolute/path/agent-playbooks，",
    "私有运行记录在 /absolute/private/run.json。先读取 AGENTS.md，",
    "用 check-run 校验记录，并重新检查目标机器、配置、授权范围和未解决问题。",
    "如果技能版本改变，先审查差异和受影响步骤，再决定如何继续。",
    "```",
    "",
    "对应的记录检查命令为：",
    "",
    "```bash",
    "node tools/check-run.mjs --file /absolute/private/run.json",
    "```",
    "",
    "`/absolute/private/run.json` 是用户自己的记录路径，不是仓库自带文件。",
    "检查器只验证记录一致性，不自动恢复任务，也不把旧的成功结果当作当前机器的验收。",
    "",
    "### 示例三：把新发现修正回技能",
    "",
    "假设使用中已复现了一个文档未覆盖的版本差异，可以这样授权本地维护：",
    "",
    "```text",
    "这次使用发现的版本差异已经复现。请在 /absolute/path/agent-playbooks 中",
    "完善对应技能：先检查已有 findings 和诊断说明，整理脱敏的适用条件及来源，",
    "修正实际操作参考或脚本，验证后再关闭 finding。未经验证的分支保持明确标记。",
    "保留旧证据，重建目录并运行相关检查；本次只修改本地文件，不提交或发布。",
    "```",
    "",
    "AI 应维护同一技能的来源、问题记录和实际流程；若问题仍阻断默认流程，",
    "保留 open finding 并调整生命周期。原始日志和账号信息留在仓库外。",
    "",
    "### 示例四：记录一项新的复杂配置技能",
    "",
    "```text",
    "请把本次已经完成的复杂配置整理进 /absolute/path/agent-playbooks，供以后复用。",
    "先检索是否已有相同目标的技能，优先完善已有技能；确需新建时使用稳定 ID。",
    "按 docs/maintenance.md 记录前置条件、操作步骤、依赖、验收、来源和已知限制，",
    "只把实际验证过的内容写为通过。不要复制私有配置、凭据或原始日志。",
    "完成本地验证和目录更新，暂不提交或发布。",
    "```",
    "",
    "流程尚未完成或验证不足的新技能应使用 `draft`，不能仅凭整理成文档就标为已验证。",
    "",
    "## 使用后持续完善",
    "",
    "详细约定见 [维护与续跑指南](docs/maintenance.md)：",
    "架构理由、约束能力和扩展边界见 [设计取舍](docs/design.md)。",
    "",
    "- 每次使用或中断后检查新发现；可复用问题写入技能的 `findings.json`，私有原始记录留在仓库外。",
    "- 修正文档/脚本和来源，验证后关闭 finding；阻断默认流程的未解决问题禁止标为 active。",
    "- `contract.evidence` 区分当前材料证据和历史证据，升级时保留旧证据，不覆盖历史成功记录。",
    "- 跨会话任务按 [run schema](schemas/run.schema.json) 保存私有交接；续跑前校验技能内容版本、操作和验收项。",
    "- 搜索结果包含环境、证据范围和未解决问题；无匹配时可换产品名、精确错误码或直接查看目录。",
    "",
    "## 维护仓库与验证修改",
    "",
    "技能内容修改所属技能包；本页使用说明维护在 [tools/lib.mjs](tools/lib.mjs) 的 `readmeText` 中。",
    "README 和 catalog.jsonl 都是生成文件，修改生成源后在仓库根目录运行：",
    "",
    "```bash",
    "npm run catalog",
    "npm run validate",
    "npm test",
    "```",
    "",
    "需要完整检查时运行 `npm run check`。它还会通过 `test:gateway` 在独立临时目录安装固定依赖，",
    "运行四项网关合成测试；需要 npm 下载网络，不使用真实账号，不调用模型，不操作 systemd 或 GUI。",
    "这些检查验证仓库和合成行为，不能代替技能在目标机器上的实际验收。",
    "",
    "## 技能",
    "",
    "| 技能 | 生命周期 | 适用范围 |",
    "|---|---|---|",
    ...rows,
    "",
    "## 边界",
    "",
    "- 当前只有首个 Codex 技能；不包含通用执行器、调度器或自动维护技能。",
    "- 反馈流程由读取本库的客户端执行，校验器约束结构和引用；不会自动收集使用记录或保证外部客户端遵守。",
    "- `contract.json`、JSONL 索引和证据结构是本仓库扩展，不是 Agent Skills 的必需字段。",
    "- 历史安装证据、仓库离线验证和新机器端到端验收分别记录，不能相互代替。",
    "- 脱敏的技能源可公开；实际凭据、日志、办公资料、备份和运行记录必须保持私有。",
    "- 提交、发布或合并前由用户确认。原创内容采用 [MIT](LICENSE)，第三方声明另行保留。",
    "",
  ].join("\n");
}

export function isMain(url) {
  return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);
}

export async function checkMarkdownLinks(path, scope) {
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = resolve(dirname(path), href.split("#")[0]);
    await resourcePath(scope, relative(scope, target).split(sep).join("/"));
  }
}
