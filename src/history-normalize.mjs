// Cross-model history normalization helpers.
//
// These functions translate history produced by one backend into a shape
// another backend can understand. Both are no-ops on clean input and never
// mutate their arguments.
//
// router.mjs is NOT safely importable: importing it starts the HTTP server
// (there is no `main` guard) and throws when CODEX_ROUTER_INTERNAL_KEY is
// unset. The three small helpers below are duplicated here to keep this
// module side-effect free.

// mirrors src/router.mjs COMPACTION_PREFIX / SUMMARY_PREFIX / decodeSummary /
// messageItem - keep in sync.
const COMPACTION_PREFIX = "kcr1:";
const SUMMARY_PREFIX =
  "Another language model started this task and produced a continuation summary. Use it to continue without repeating completed work:";

function decodeSummary(value) {
  if (typeof value !== "string" || !value.startsWith(COMPACTION_PREFIX)) return undefined;
  try {
    return Buffer.from(value.slice(COMPACTION_PREFIX.length), "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function messageItem(text) {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

/**
 * Convert foreign (kcr1:) compaction items in a Responses-API input array
 * into plain user messages the native backend can read. Native OpenAI
 * compaction items (cmp_...) are left untouched so the GPT backend can
 * decrypt them itself. No-op on clean input; never mutates the argument.
 */
export function convertForeignCompaction(input) {
  if (!Array.isArray(input)) return input;
  let changed = false;
  const result = input.map((item) => {
    if (item?.type !== "compaction") return item;
    const content = String(item.encrypted_content ?? "");
    if (!content.startsWith(COMPACTION_PREFIX)) return item;
    const summary = decodeSummary(content);
    changed = true;
    return messageItem(
      summary
        ? `${SUMMARY_PREFIX}\n\n${summary}`
        : "[Earlier conversation history was compacted in an unreadable format.]",
    );
  });
  return changed ? result : input;
}

/**
 * Repair Chat Completions history where an assistant tool_calls array is
 * missing one or more following tool messages - a common artifact after
 * LiteLLM translates Responses history to Chat Completions. For each
 * missing tool_call_id, synthesize a placeholder tool message immediately
 * after the assistant message. No-op when every tool_call_id already has a
 * matching tool message; never mutates the argument.
 */
export function repairToolCallPairing(messages) {
  if (!Array.isArray(messages)) return messages;

  const needsRepair = messages.some((msg, idx) => {
    if (
      msg?.role !== "assistant" ||
      !Array.isArray(msg.tool_calls) ||
      msg.tool_calls.length === 0
    ) {
      return false;
    }
    const ids = [...new Set(msg.tool_calls.map((tc) => tc?.id).filter((id) => id !== undefined))];
    if (ids.length === 0) return false;
    const matched = new Set();
    for (let i = idx + 1; i < messages.length; i += 1) {
      const m = messages[i];
      if (m?.role === "tool" && ids.includes(m.tool_call_id)) {
        matched.add(m.tool_call_id);
      }
    }
    return ids.some((id) => !matched.has(id));
  });

  if (!needsRepair) return messages;

  const result = [];
  for (let idx = 0; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    result.push(msg);
    if (
      msg?.role === "assistant" &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0
    ) {
      const ids = [...new Set(msg.tool_calls.map((tc) => tc?.id).filter((id) => id !== undefined))];
      if (ids.length === 0) continue;
      const matched = new Set();
      for (let i = idx + 1; i < messages.length; i += 1) {
        const m = messages[i];
        if (m?.role === "tool" && ids.includes(m.tool_call_id)) {
          matched.add(m.tool_call_id);
        }
      }
      for (const id of ids) {
        if (!matched.has(id)) {
          result.push({
            role: "tool",
            tool_call_id: id,
            content: "[tool result not available - cross-model history normalized]",
          });
        }
      }
    }
  }
  return result;
}
