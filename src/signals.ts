import type { ChatRequest } from "./providers/types.js";

export interface ToolCallSignal {
  name: string;
  arguments?: string | Record<string, unknown>;
}

export interface ToolResultSignal {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ExecutionSignals {
  totalMessages: number;
  totalCharacters: number;
  toolCalls: ToolCallSignal[];
  toolResults: ToolResultSignal[];

  // Heuristics
  filesTouched: string[];
  repeatedEdits: boolean;
  hasTestFailures: boolean;
  consecutiveFailures: number;
}

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

export function extractSignals(req: ChatRequest): ExecutionSignals {
  const signals: ExecutionSignals = {
    totalMessages: req.messages.length,
    totalCharacters: 0,
    toolCalls: [],
    toolResults: [],
    filesTouched: [],
    repeatedEdits: false,
    hasTestFailures: false,
    consecutiveFailures: 0,
  };

  // 1. Core Metrics & Base Text Extraction
  for (const msg of req.messages) {
    signals.totalCharacters += msg.content.length;
  }

  const raw = req.rawBody as any;
  if (!raw) return signals;

  // 2. Parse Tool Calls & Results per Dialect
  if (req.dialect === "openai") {
    const messages = raw.messages ?? [];
    for (const m of messages) {
      // Extract Tool Calls
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc.type === "function" && tc.function) {
            signals.toolCalls.push({
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }
      }
      // Extract Tool Results
      if (m.role === "tool") {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        signals.toolResults.push({
          toolUseId: m.tool_call_id ?? "",
          content,
          isError: isFailureContent(content),
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
            signals.toolResults.push({
              toolUseId: part.tool_use_id ?? "",
              content: contentStr,
              isError: part.is_error === true || isFailureContent(contentStr),
            });
          }
        }
      }
    }
  }

  // 3. Compute Heuristics (Files Touched & Repeated Edits)
  const editTools = ["write", "edit", "replace", "save", "patch", "modify", "str_replace_editor"];
  const fileEdits: string[] = [];

  for (const tc of signals.toolCalls) {
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

  // 4. Compute Failures (Consecutive failures & hasTestFailures)
  let consecutive = 0;
  for (const res of signals.toolResults) {
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
