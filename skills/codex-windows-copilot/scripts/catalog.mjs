import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MESSAGE_EFFORTS } from "./messages.mjs";

export const PREFIX = "windows-copilot/";
const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(value);

// Keep the already validated GitHub catalog verbatim. Never manufacture an App
// catalog from the upstream project's fallback list or another account's snapshot.
export function buildCatalog(github, windows, { messages = false } = {}) {
  if (!Array.isArray(github?.models) || !github.models.length || !Array.isArray(windows?.data)) {
    throw new Error("Expected an existing Codex catalog and fresh Windows /v1/models metadata.");
  }
  const routes = Object.create(null);
  const models = structuredClone(github.models);
  for (const model of models) {
    if (!validId(model.slug) || model.slug.startsWith(PREFIX) || routes[model.slug]) {
      throw new Error("Invalid, duplicated or reserved GitHub model ID.");
    }
    routes[model.slug] = { provider: "github", upstream_model: model.slug };
  }
  const template = models[0];
  if (typeof template.base_instructions !== "string" || !template.truncation_policy) {
    throw new Error("A client-compatible existing catalog template is required.");
  }
  const excluded = [];
  const seen = new Set();
  for (const model of windows.data) {
    if (!validId(model?.id) || seen.has(model.id)) throw new Error("Invalid or duplicated Windows model ID.");
    seen.add(model.id);
    const supports = model.capabilities?.supports;
    const native = model.supported_endpoints?.includes("/responses");
    const translated = !native && messages && model.supported_endpoints?.includes("/v1/messages");
    let reason;
    if (!native && !translated) reason = "No native Responses endpoint";
    else if (model.policy?.state === "disabled" || model.model_picker_enabled === false) reason = "Disabled by upstream";
    else if (supports?.tool_calls === false || supports?.streaming === false) reason = "Explicitly lacks tools or streaming";
    if (reason) { excluded.push({ id: model.id, reason }); continue; }
    const levels = supports?.reasoning_effort;
    const context = model.capabilities?.limits?.max_context_window_tokens;
    if (!Array.isArray(levels) || !levels.length || levels.some(level => !efforts.has(level)) ||
        translated && levels.some(level => !MESSAGE_EFFORTS.includes(level)) ||
        new Set(levels).size !== levels.length || !Number.isSafeInteger(context) || context <= 0) {
      throw new Error("Windows model has unrecognized reasoning/context metadata; review before adding it.");
    }
    const slug = PREFIX + model.id;
    const entry = {
      ...structuredClone(template),
      slug,
      display_name: `${model.name || model.id} (Windows Copilot)`,
      description: `${model.id} through the local Windows Copilot Code ${translated ? "Messages compatibility adapter" : "Responses relay"}; live verification required.`,
      priority: models.length,
      default_reasoning_level: levels.includes("medium") ? "medium" : levels[0],
      supported_reasoning_levels: levels.map(effort => ({ effort, description: effort })),
      context_window: context,
      max_context_window: context,
      // Do not inherit GitHub transport/capability claims for a different provider.
      input_modalities: supports?.vision === true ? ["text", "image"] : ["text"],
      supports_parallel_tool_calls: supports?.parallel_tool_calls === true,
      supports_reasoning_summaries: false,
      supports_reasoning_summary_parameter: false,
      support_verbosity: false,
      default_verbosity: null,
      availability_nux: null,
      upgrade: null,
      experimental_supported_tools: [],
    };
    // The Windows relay has no /responses/compact endpoint. Do not copy a
    // GitHub compaction threshold or claim long-session support.
    delete entry.auto_compact_token_limit;
    models.push(entry);
    routes[slug] = { provider: "windows", upstream_model: model.id };
    if (translated) Object.assign(routes[slug], { protocol: "messages", reasoning_efforts: levels, default_effort: entry.default_reasoning_level });
  }
  if (models.length === github.models.length) throw new Error("No eligible native Windows Responses models.");
  return { catalog: { models }, routes, excluded };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const messages = args[0] === "--messages";
    if (messages) args.shift();
    if (args.length !== 3) throw new Error("Usage: node catalog.mjs [--messages] <github-catalog.json> <windows-models.json> <new-output-directory>");
    const [github, windows] = await Promise.all(args.slice(0, 2).map(async p => JSON.parse(await readFile(resolve(p), "utf8"))));
    const output = buildCatalog(github, windows, { messages });
    const dir = resolve(args[2]);
    await mkdir(dir); // Refuse existing paths, including a previous generation.
    for (const [name, value] of [["model-catalog.json", output.catalog], ["routes.json", output.routes], ["excluded.json", output.excluded]]) {
      await writeFile(resolve(dir, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    }
    console.log(JSON.stringify({ status: "prepared", models: output.catalog.models.length, excluded: output.excluded }));
  } catch {
    console.error("Catalog preparation failed. Check input metadata and use a new output directory; no existing catalog was replaced.");
    process.exitCode = 1;
  }
}
