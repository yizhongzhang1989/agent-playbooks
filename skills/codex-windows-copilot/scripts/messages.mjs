import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export const MESSAGE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid = prefix => prefix + randomUUID().replaceAll("-", "");

export class MessagesError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requireValue(condition, code, status = 400) {
  if (!condition) throw new MessagesError(code, status);
}

function jsonObject(text, code) {
  try {
    const value = JSON.parse(text);
    requireValue(object(value), code);
    return value;
  } catch {
    throw new MessagesError(code);
  }
}

export function createThinkingCodec(bridgeKey) {
  // Durable, purpose-separated encryption; signed thinking never becomes visible answer text.
  const key = createHmac("sha256", Buffer.from(bridgeKey, "hex")).update("windows-messages-thinking-v1").digest();
  return {
    seal(block, model) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(model));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(block), "utf8"), cipher.final()]);
      return "wcm1." + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
    },
    open(value, model) {
      try {
        requireValue(typeof value === "string" && /^wcm1\.[A-Za-z0-9_-]+$/.test(value), "messages_reasoning_state_invalid");
        const bytes = Buffer.from(value.slice(5), "base64url");
        requireValue(bytes.length > 28, "messages_reasoning_state_invalid");
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(model));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const block = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
        requireValue(object(block) && (
          block.type === "thinking" && typeof block.thinking === "string" && typeof block.signature === "string" ||
          block.type === "redacted_thinking" && typeof block.data === "string"
        ), "messages_reasoning_state_invalid");
        return block;
      } catch {
        throw new MessagesError("messages_reasoning_state_invalid");
      }
    },
  };
}

function contentBlocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  requireValue(Array.isArray(content), "messages_content_required");
  return content.map(part => {
    requireValue(object(part), "messages_content_invalid");
    if (["input_text", "output_text", "text"].includes(part.type) && typeof part.text === "string") {
      return { type: "text", text: part.text };
    }
    if (part.type === "input_image") {
      const match = typeof part.image_url === "string" && part.image_url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      requireValue(match && Buffer.from(match[2], "base64").toString("base64") === match[2], "messages_base64_image_required");
      return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
    }
    throw new MessagesError("messages_content_type_unsupported");
  });
}

function toolIdentity(tool, namespace) {
  requireValue(identifier(tool.name) && (namespace === undefined || identifier(namespace)), "messages_tool_name_invalid");
  const identity = JSON.stringify([namespace ?? null, tool.name]);
  const name = namespace === undefined && tool.name.length <= 64 && !tool.name.startsWith("wct_")
    ? tool.name : "wct_" + createHash("sha256").update(identity).digest("hex").slice(0,40);
  return { name: tool.name, namespace, upstreamName: name, type: tool.type };
}

function translateTools(tools) {
  requireValue(Array.isArray(tools), "messages_tools_invalid");
  const names = new Map();
  const output = [];
  function add(tool, namespace) {
    requireValue(object(tool), "messages_tool_invalid");
    if (tool.type === "namespace") {
      requireValue(namespace === undefined && identifier(tool.name) && Array.isArray(tool.tools), "messages_namespace_invalid");
      for (const child of tool.tools) add(child, tool.name);
      return;
    }
    requireValue(["function", "custom"].includes(tool.type), "messages_hosted_tool_unsupported");
    const identity = toolIdentity(tool, namespace);
    requireValue(!names.has(identity.upstreamName), "messages_duplicate_tool");
    let description = tool.description ?? "";
    requireValue(typeof description === "string", "messages_tool_description_invalid");
    let schema = tool.parameters;
    if (tool.type === "custom") {
      schema = { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false };
      description += "\nReturn the exact freeform tool input in the input string, not a JSON encoding of the tool input.";
      if (tool.format?.type === "grammar") {
        requireValue(typeof tool.format.definition === "string" && ["lark", "regex"].includes(tool.format.syntax), "messages_custom_grammar_invalid");
        description += `\nThe input must satisfy this ${tool.format.syntax} grammar:\n${tool.format.definition}`;
      } else {
        requireValue(tool.format === undefined || tool.format.type === "text", "messages_custom_format_unsupported");
      }
    }
    requireValue(object(schema) && schema.type === "object", "messages_tool_schema_invalid");
    names.set(identity.upstreamName, identity);
    output.push({ name: identity.upstreamName, description, input_schema: schema });
  }
  for (const tool of tools) add(tool);
  return { tools: output, names };
}

export function toMessagesRequest(body, route, codec) {
  const allowed = new Set([
    "model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "reasoning",
    "stream", "store", "max_output_tokens", "include", "text", "truncation", "metadata",
    "client_metadata", "prompt_cache_key",
  ]);
  requireValue(Object.keys(body).every(key => allowed.has(key)), "messages_request_option_unsupported");
  requireValue(body.stream === undefined || typeof body.stream === "boolean", "messages_stream_invalid");
  requireValue(body.store === undefined || body.store === false, "windows_requires_store_false");
  requireValue(body.truncation === undefined || body.truncation === "disabled", "messages_truncation_unsupported");
  requireValue(body.include === undefined || Array.isArray(body.include) && body.include.every(value => value === "reasoning.encrypted_content"), "messages_include_unsupported");
  requireValue(body.text === undefined || object(body.text) && Object.keys(body.text).every(key => key === "format") &&
    (body.text.format === undefined || object(body.text.format) && body.text.format.type === "text" && Object.keys(body.text.format).length === 1), "messages_output_format_unsupported");
  requireValue(body.reasoning === undefined || object(body.reasoning) && Object.keys(body.reasoning).every(key => key === "effort"), "messages_reasoning_option_unsupported");
  const effort = body.reasoning?.effort ?? route.default_effort;
  requireValue(route.reasoning_efforts.includes(effort), "messages_reasoning_effort_unsupported");
  const maxTokens = body.max_output_tokens ?? 32768;
  requireValue(Number.isSafeInteger(maxTokens) && maxTokens > 0 && maxTokens <= 128000, "messages_max_output_tokens_invalid");
  const choice = body.tool_choice ?? "auto";
  requireValue(choice === "auto" || choice === "none", "messages_forced_tool_choice_unsupported");
  requireValue(body.parallel_tool_calls === undefined || typeof body.parallel_tool_calls === "boolean", "messages_parallel_tools_invalid");
  const translated = translateTools(body.tools ?? []);
  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
  requireValue(Array.isArray(input) && input.length > 0, "messages_input_required");
  const system = [];
  if (body.instructions !== undefined) {
    requireValue(typeof body.instructions === "string", "messages_instructions_invalid");
    if (body.instructions) system.push({ type: "text", text: body.instructions });
  }
  const messages = [], pending = new Set(), seenCalls = new Set();
  function push(role, content) {
    if (role === "assistant" && pending.size) {
      requireValue(messages.at(-1)?.role === "assistant", "messages_tool_results_required");
    }
    if (messages.at(-1)?.role === role) messages.at(-1).content.push(...content);
    else messages.push({ role, content });
  }
  for (const item of input) {
    requireValue(object(item), "messages_input_item_invalid");
    if (item.type === undefined || item.type === "message") {
      requireValue(["system", "developer", "user", "assistant"].includes(item.role), "messages_role_unsupported");
      const blocks = contentBlocks(item.content);
      if (["system", "developer"].includes(item.role)) {
        requireValue(blocks.every(block => block.type === "text"), "messages_system_text_required");
        system.push(...blocks);
      } else {
        requireValue(item.role === "assistant" || pending.size === 0, "messages_tool_results_required");
        push(item.role, blocks);
      }
    } else if (item.type === "reasoning") {
      push("assistant", [codec.open(item.encrypted_content, body.model)]);
    } else if (["function_call", "custom_tool_call"].includes(item.type)) {
      requireValue(identifier(item.call_id) && !seenCalls.has(item.call_id), "messages_tool_call_id_invalid");
      requireValue(item.encrypted_function_args === undefined, "messages_encrypted_arguments_unsupported");
      const custom = item.type === "custom_tool_call";
      const identity = toolIdentity({ name: item.name, type: custom ? "custom" : "function" }, item.namespace);
      const args = custom ? { input: item.input } : jsonObject(item.arguments, "messages_tool_arguments_invalid");
      requireValue(!custom || typeof item.input === "string", "messages_custom_input_invalid");
      push("assistant", [{ type: "tool_use", id: item.call_id, name: identity.upstreamName, input: args }]);
      pending.add(item.call_id);
      seenCalls.add(item.call_id);
    } else if (["function_call_output", "custom_tool_call_output"].includes(item.type)) {
      requireValue(pending.delete(item.call_id), "messages_orphan_tool_result");
      push("user", [{ type: "tool_result", tool_use_id: item.call_id, content: contentBlocks(item.output) }]);
    } else {
      throw new MessagesError("messages_history_type_unsupported");
    }
  }
  requireValue(pending.size === 0 && messages.length > 0 && messages.at(-1).role === "user", "messages_user_or_tool_result_required");
  const request = {
    model: route.upstream_model, messages, max_tokens: maxTokens, stream: true,
    thinking: { type: "adaptive" }, output_config: { effort },
  };
  if (system.length) request.system = system;
  if (translated.tools.length) {
    request.tools = translated.tools;
    request.tool_choice = { type: choice };
    if (body.parallel_tool_calls === false && choice !== "none") request.tool_choice.disable_parallel_tool_use = true;
  }
  return { request, names: translated.names, codec, model: body.model, stream: body.stream === true };
}

function usageCounts(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)) return null;
  const cached = usage.cache_read_input_tokens ?? 0;
  const created = usage.cache_creation_input_tokens ?? 0;
  if (![usage.input_tokens, usage.output_tokens, cached, created].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  const input = usage.input_tokens + cached + created;
  return { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: usage.output_tokens, total_tokens: input + usage.output_tokens };
}

async function writeChunk(res, text) {
  requireValue(!res.destroyed && !res.writableEnded, "messages_client_disconnected", 502);
  if (res.write(text)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { res.off("drain", drained); res.off("close", closed); res.off("error", failed); };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new MessagesError("messages_client_disconnected", 502)); };
    const failed = error => { cleanup(); reject(error); };
    res.once("drain", drained).once("close", closed).once("error", failed);
  });
}

export async function forwardMessages(upstream, res, context) {
  requireValue(/^text\/event-stream(?:;|$)/i.test(upstream.headers["content-type"] ?? ""), "messages_upstream_sse_required", 502);
  requireValue(!upstream.headers["content-encoding"] || upstream.headers["content-encoding"] === "identity", "messages_upstream_encoding_unsupported", 502);
  const response = { id: uuid("resp_wcm_"), object: "response", created_at: Math.floor(Date.now() / 1000), status: "in_progress", model: context.model, output: [], error: null, incomplete_details: null };
  let sequence = 0, started = false, stopped = false, stopReason, open, usage;
  const blocks = [];
  const headers = { "cache-control": "no-store", "content-type": context.stream ? "text/event-stream" : "application/json" };
  for (const name of ["x-request-id", "request-id"]) if (upstream.headers[name]) headers[name] = upstream.headers[name];
  async function emit(type, data) {
    if (!context.stream) return;
    if (!res.headersSent) res.writeHead(200, headers);
    await writeChunk(res, `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
  }
  async function event(value) {
    requireValue(object(value) && typeof value.type === "string", "messages_invalid_event", 502);
    if (value.type === "ping" || value.type === "llmapi.call_cost") return;
    if (value.type === "error") {
      const code = /^[a-z_]+$/.test(value.error?.type ?? "") ? value.error.type : "error";
      throw new MessagesError(`messages_upstream_${code}`, 502);
    }
    requireValue(!stopped, "messages_event_after_stop", 502);
    if (value.type === "message_start") {
      requireValue(!started && value.message?.model === context.request.model && value.message.role === "assistant" &&
        Array.isArray(value.message.content) && value.message.content.length === 0, "messages_invalid_start", 502);
      started = true;
      usage = value.message.usage;
      await emit("response.created", { response: { ...response, output: [] } });
      await emit("response.in_progress", { response: { ...response, output: [] } });
      return;
    }
    requireValue(started, "messages_missing_start", 502);
    if (value.type === "content_block_start") {
      requireValue(!open && value.index === blocks.length && object(value.content_block), "messages_block_order_invalid", 502);
      const block = structuredClone(value.content_block);
      let item;
      if (block.type === "text") {
        requireValue(typeof block.text === "string", "messages_text_invalid", 502);
        item = { type: "message", id: uuid("msg_wcm_"), role: "assistant", status: "in_progress", content: [{ type: "output_text", text: block.text, annotations: [] }] };
      } else if (block.type === "tool_use") {
        const identity = context.names.get(block.name);
        requireValue(identity && identifier(block.id) && object(block.input) &&
          !blocks.some(entry => entry.block.type === "tool_use" && entry.block.id === block.id), "messages_unknown_or_duplicate_tool", 502);
        item = { type: identity.type === "custom" ? "custom_tool_call" : "function_call", id: uuid("fc_wcm_"), call_id: block.id, name: identity.name, status: "in_progress" };
        if (identity.namespace !== undefined) item.namespace = identity.namespace;
        if (identity.type === "custom") item.input = "";
        else item.arguments = "";
      } else if (block.type === "thinking" || block.type === "redacted_thinking") {
        requireValue(block.type === "thinking" ? typeof block.thinking === "string" : typeof block.data === "string", "messages_thinking_invalid", 502);
        item = { type: "reasoning", id: uuid("rs_wcm_"), summary: [] };
      } else {
        throw new MessagesError("messages_upstream_content_unsupported", 502);
      }
      open = { block, item, outputIndex: blocks.length, json: "" };
      blocks.push(open);
      response.output.push(item);
      await emit("response.output_item.added", { output_index: open.outputIndex, item: item.type === "message" ? { ...item, content: [] } : { ...item } });
      if (block.type === "text") {
        await emit("response.content_part.added", { item_id: item.id, output_index: open.outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        if (block.text) await emit("response.output_text.delta", { item_id: item.id, output_index: open.outputIndex, content_index: 0, delta: block.text });
      }
    } else if (value.type === "content_block_delta") {
      requireValue(open && value.index === open.outputIndex && object(value.delta), "messages_delta_order_invalid", 502);
      const { block, item, outputIndex } = open;
      const delta = value.delta;
      if (block.type === "text" && delta.type === "text_delta" && typeof delta.text === "string") {
        block.text += delta.text;
        item.content[0].text = block.text;
        await emit("response.output_text.delta", { item_id: item.id, output_index: outputIndex, content_index: 0, delta: delta.text });
      } else if (block.type === "tool_use" && delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        open.json += delta.partial_json;
        if (item.type === "function_call") await emit("response.function_call_arguments.delta", { item_id: item.id, output_index: outputIndex, delta: delta.partial_json });
      } else if (block.type === "thinking" && delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        block.thinking += delta.thinking;
      } else if (block.type === "thinking" && delta.type === "signature_delta" && typeof delta.signature === "string") {
        block.signature = (block.signature ?? "") + delta.signature;
      } else {
        throw new MessagesError("messages_delta_type_unsupported", 502);
      }
    } else if (value.type === "content_block_stop") {
      requireValue(open && value.index === open.outputIndex, "messages_block_stop_invalid", 502);
      const { block, item } = open;
      if (block.type === "tool_use") {
        if (item.type === "function_call") item.arguments = open.json || JSON.stringify(block.input);
      } else if (item.type === "reasoning") {
        requireValue(block.type === "redacted_thinking" || typeof block.signature === "string" && block.signature.length > 0, "messages_thinking_signature_missing", 502);
        item.encrypted_content = context.codec.seal(block, context.model);
      }
      open = undefined;
    } else if (value.type === "message_delta") {
      requireValue(!open && object(value.delta), "messages_message_delta_invalid", 502);
      if (value.delta.stop_reason !== undefined) stopReason = value.delta.stop_reason;
      if (value.usage) usage = { ...usage, ...value.usage };
    } else if (value.type === "message_stop") {
      requireValue(!open && typeof stopReason === "string", "messages_stop_reason_missing", 502);
      stopped = true;
    } else {
      throw new MessagesError("messages_event_type_unsupported", 502);
    }
  }
  const decoder = new StringDecoder("utf8");
  let buffer = "", bytes = 0;
  for await (const chunk of upstream) {
    bytes += chunk.length;
    requireValue(bytes <= MAX_STREAM_BYTES, "messages_stream_too_large", 502);
    buffer += decoder.write(chunk);
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) {
        let value;
        try { value = JSON.parse(data); }
        catch { throw new MessagesError("messages_invalid_event_json", 502); }
        await event(value);
      }
    }
  }
  buffer += decoder.end();
  requireValue(!buffer.trim() && started && stopped, "messages_stream_incomplete", 502);
  requireValue(["end_turn", "tool_use", "max_tokens"].includes(stopReason), `messages_stop_${identifier(stopReason) ? stopReason : "unsupported"}`, 502);
  const tools = blocks.filter(entry => entry.block.type === "tool_use");
  requireValue(stopReason !== "tool_use" || tools.length > 0, "messages_tool_stop_without_call", 502);
  requireValue(stopReason !== "end_turn" || tools.length === 0, "messages_unexpected_tool_stop", 502);
  response.status = stopReason === "max_tokens" ? "incomplete" : "completed";
  if (response.status === "incomplete") response.incomplete_details = { reason: "max_output_tokens" };
  response.usage = usageCounts(usage);
  // Validate every completed tool before emitting any executable output item.
  if (response.status === "completed") {
    for (const { block, item, json } of tools) {
      const args = json ? jsonObject(json, "messages_upstream_tool_json_invalid") : block.input;
      if (item.type === "custom_tool_call") {
        requireValue(typeof args.input === "string" && Object.keys(args).length === 1, "messages_upstream_custom_input_invalid", 502);
        item.input = args.input;
      } else item.arguments = JSON.stringify(args);
    }
  }
  for (const { item, outputIndex } of blocks) {
    if (item.type !== "reasoning") item.status = response.status;
    // A truncated tool block must never be dispatched as a completed executable call.
    if (response.status === "incomplete" && ["function_call", "custom_tool_call"].includes(item.type)) continue;
    if (item.type === "message") {
      await emit("response.output_text.done", { item_id: item.id, output_index: outputIndex, content_index: 0, text: item.content[0].text });
      await emit("response.content_part.done", { item_id: item.id, output_index: outputIndex, content_index: 0, part: item.content[0] });
    } else if (item.type === "function_call") {
      await emit("response.function_call_arguments.done", { item_id: item.id, output_index: outputIndex, arguments: item.arguments });
    } else if (item.type === "custom_tool_call") {
      await emit("response.custom_tool_call_input.done", { item_id: item.id, output_index: outputIndex, input: item.input });
    }
    await emit("response.output_item.done", { output_index: outputIndex, item });
  }
  if (context.stream) {
    await emit(response.status === "completed" ? "response.completed" : "response.incomplete", { response });
    res.end();
  } else {
    res.writeHead(200, headers);
    res.end(JSON.stringify(response));
  }
}
