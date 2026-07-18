import type { ChatRequest } from "./providers/types.js";

export interface ToolCallSignal {
  name: string;
  arguments?: string | Record<string, unknown>;
}

export interface ToolResultSignal {
  toolUseId: string;
  content: string;
  isError: boolean;
  name?: string;
}

export interface ExecutionSignals {
  totalMessages: number;
  totalCharacters: number;
  recentMessages: number;
  recentCharacters: number;
  /** Full request history, retained for telemetry and future learning. */
  toolCalls: ToolCallSignal[];
  toolResults: ToolResultSignal[];

  /**
   * Routing heuristics are intentionally recent. Agent requests commonly
   * resend the whole conversation, so using the full arrays here would make
   * an old failure or edit permanently increase difficulty.
   */
  filesTouched: string[];
  repeatedEdits: boolean;
  hasTestFailures: boolean;
  consecutiveFailures: number;
}

const RECENT_EXECUTION_LIMIT = 8;

/** Case-insensitive keys to search for file paths in tool arguments */
const FILE_PATH_KEYS = ["path", "filepath", "file", "filename", "targetfile", "absolutepath"];

function extractFilePath(args: unknown): string | null {
  if (!args) return null;
  let obj: Record<string, unknown> = {};
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return null;
    }
  } else if (typeof args === "object" && args !== null) {
    obj = args as Record<string, unknown>;
  }

  for (const [k, val] of Object.entries(obj)) {
    if (FILE_PATH_KEYS.includes(k.toLowerCase()) && typeof val === "string" && val.length > 0) {
      return val;
    }
  }
  return null;
}

/**
 * Word-boundary matching avoids substring false positives ("failover", "failsafe"
 * are not failures). `fail` variants, `error:`, assertion/exit/command markers count.
 */
const FAILURE_RE = /\bfail(ed|ing|ure|s)?\b|error:|assertion\s?error|exit status|command failed/i;

function isFailureContent(content: string): boolean {
  return FAILURE_RE.test(content);
}

/** A failure result that specifically points at a test run. */
const TEST_FAILURE_RE = /\btests?\b|\bfail(ed|ing|ure|s)?\b/i;

function isNewUserTask(req: ChatRequest): boolean {
  const raw = req.rawBody as any;
  if (!raw) return true;

  if (req.dialect === "openai") {
    const messages = raw.messages ?? raw.input ?? [];
    if (messages.length === 0) return true;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && (lastMsg.role === "tool" || lastMsg.type === "function_call_output" || lastMsg.role === "assistant")) {
      return false;
    }
    return true;
  } else if (req.dialect === "anthropic") {
    const messages = raw.messages ?? [];
    if (messages.length === 0) return true;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
      if (lastMsg.role === "assistant") return false;
      if (lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
        const hasToolResult = lastMsg.content.some((c: any) => c && c.type === "tool_result");
        if (hasToolResult) {
          return false;
        }
      }
    }
    return true;
  }

  return true;
}

export function extractSignals(req: ChatRequest): ExecutionSignals {
  const signals: ExecutionSignals = {
    totalMessages: req.messages.length,
    totalCharacters: 0,
    recentMessages: 0,
    recentCharacters: 0,
    toolCalls: [],
    toolResults: [],
    filesTouched: [],
    repeatedEdits: false,
    hasTestFailures: false,
    consecutiveFailures: 0,
  };

  const toolNamesById = new Map<string, string>();

  // 1. Core Metrics & Base Text Extraction
  const raw = req.rawBody as any;
  if (Array.isArray(req.messages) && req.messages.length > 0) {
    for (const msg of req.messages) {
      signals.totalCharacters += (msg.content || "").length;
    }
  } else if (raw && Array.isArray(raw.input)) {
    signals.totalMessages = raw.input.length;
    for (const msg of raw.input) {
      if (msg) {
        if (typeof msg.content === "string") {
          signals.totalCharacters += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block && typeof block.text === "string") {
              signals.totalCharacters += block.text.length;
            }
          }
        }
      }
    }
  }

  // Compute recent context metrics (rely on raw if present, otherwise fallback)
  const recentMsgSlice = raw && Array.isArray(raw.messages)
    ? raw.messages.slice(-RECENT_EXECUTION_LIMIT)
    : (raw && Array.isArray(raw.input)
        ? raw.input.slice(-RECENT_EXECUTION_LIMIT)
        : req.messages.slice(-RECENT_EXECUTION_LIMIT));
  signals.recentMessages = recentMsgSlice.length;
  for (const msg of recentMsgSlice) {
    if (msg) {
      if (typeof msg.content === "string") {
        signals.recentCharacters += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block.text === "string") {
            signals.recentCharacters += block.text.length;
          }
        }
      }
    }
  }

  if (!raw) return signals;

  // 2. Parse Tool Calls & Results per Dialect
  if (req.dialect === "openai") {
    const messages = raw.messages ?? raw.input ?? [];
    for (const m of messages) {
      if (!m) continue;
      // Extract Tool Calls (Chat Completions)
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc.type === "function" && tc.function) {
            if (tc.id) {
              toolNamesById.set(tc.id, tc.function.name);
            }
            signals.toolCalls.push({
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }
      }
      // Extract Tool Calls (Responses API)
      else if (m.type === "function_call") {
        const id = m.call_id || m.id;
        if (id && m.name) {
          toolNamesById.set(id, m.name);
        }
        signals.toolCalls.push({
          name: m.name ?? "",
          arguments: m.arguments,
        });
      }
      // Extract Tool Results (Chat Completions)
      else if (m.role === "tool") {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        const id = m.tool_call_id ?? "";
        signals.toolResults.push({
          toolUseId: id,
          content,
          isError: isFailureContent(content),
          name: m.name || toolNamesById.get(id),
        });
      }
      // Extract Tool Results (Responses API)
      else if (m.type === "function_call_output") {
        const content = typeof m.output === "string" ? m.output : JSON.stringify(m.output ?? "");
        const id = m.call_id ?? "";
        signals.toolResults.push({
          toolUseId: id,
          content,
          isError: isFailureContent(content),
          name: toolNamesById.get(id),
        });
      }
    }
  } else if (req.dialect === "anthropic") {
    const messages = raw.messages ?? [];
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          // Extract Tool Calls
          if (m.role === "assistant" && part.type === "tool_use") {
            if (part.id) {
              toolNamesById.set(part.id, part.name);
            }
            signals.toolCalls.push({
              name: part.name,
              arguments: part.input,
            });
          }
          // Extract Tool Results
          if (m.role === "user" && part.type === "tool_result") {
            let contentStr = "";
            if (typeof part.content === "string") {
              contentStr = part.content;
            } else if (Array.isArray(part.content)) {
              contentStr = part.content
                .map((c: any) => (c && typeof c === "object" && c.type === "text" ? String(c.text ?? "") : ""))
                .join("");
            }
            const id = part.tool_use_id ?? "";
            signals.toolResults.push({
              toolUseId: id,
              content: contentStr,
              isError: part.is_error === true || isFailureContent(contentStr),
              name: toolNamesById.get(id),
            });
          }
        }
      }
    }
  }

  // 3. Compute recent heuristics (Files Touched & Repeated Edits).
  if (isNewUserTask(req)) {
    // New task boundary: start with a clean slate for task heuristics
    return signals;
  }

  // Keep the full arrays above, but do not let an accumulated conversation
  // history make a later, unrelated request look permanently difficult.
  const recentToolCalls = signals.toolCalls.slice(-RECENT_EXECUTION_LIMIT);
  const editTools = ["write", "edit", "replace", "save", "patch", "modify", "str_replace_editor"];
  const fileEdits: string[] = [];

  for (const tc of recentToolCalls) {
    const path = extractFilePath(tc.arguments);
    if (path) {
      if (!signals.filesTouched.includes(path)) {
        signals.filesTouched.push(path);
      }
      const lowerName = tc.name.toLowerCase();
      if (editTools.some((t) => lowerName.includes(t))) {
        fileEdits.push(path);
      }
    }
  }

  // Detect repeated edits: did we edit the same file multiple times?
  if (fileEdits.length >= 2) {
    for (let i = 0; i < fileEdits.length - 1; i++) {
      if (fileEdits[i] === fileEdits[i + 1]) {
        signals.repeatedEdits = true;
        break;
      }
    }
  }

  // 4. Compute recent failure signals. A successful tool result resolves
  // earlier failures; only the unresolved trailing segment can influence
  // the next routing decision.
  // Note: Only state-modifying or execution tools clear failures.
  const CLEAR_FAILURES_TOOLS = ["write", "edit", "replace", "save", "patch", "modify", "str_replace_editor", "command", "exec", "run", "test", "bash", "shell"];
  const recentToolResults = signals.toolResults.slice(-RECENT_EXECUTION_LIMIT);
  let lastSuccess = -1;
  for (let i = recentToolResults.length - 1; i >= 0; i--) {
    const result = recentToolResults[i];
    if (result && !result.isError) {
      const toolName = (result.name || "").toLowerCase();
      // If result.name is undefined (common in test mocks), default to true.
      // Otherwise, only clear if the tool matches CLEAR_FAILURES_TOOLS.
      const isClearingTool = result.name === undefined || CLEAR_FAILURES_TOOLS.some(t => toolName.includes(t));
      if (isClearingTool) {
        lastSuccess = i;
        break;
      }
    }
  }

  const unresolvedResults = recentToolResults.slice(lastSuccess + 1);
  let consecutive = 0;
  for (const res of unresolvedResults) {
    if (res.isError) {
      consecutive++;
      if (TEST_FAILURE_RE.test(res.content)) {
        signals.hasTestFailures = true;
      }
    } else {
      consecutive = 0;
    }
  }
  signals.consecutiveFailures = consecutive;

  return signals;
}
