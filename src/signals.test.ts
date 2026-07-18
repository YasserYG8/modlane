import { expect, test } from "vitest";
import type { ChatRequest } from "./providers/types.js";
import { extractSignals } from "./signals.js";

test("extracts basic metrics from ChatRequest", () => {
  const req: ChatRequest = {
    model: "test-model",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ],
  };

  const signals = extractSignals(req);
  expect(signals.totalMessages).toBe(2);
  expect(signals.totalCharacters).toBe(14); // 5 + 9
  expect(signals.toolCalls).toHaveLength(0);
  expect(signals.toolResults).toHaveLength(0);
  expect(signals.filesTouched).toHaveLength(0);
  expect(signals.repeatedEdits).toBe(false);
  expect(signals.hasTestFailures).toBe(false);
  expect(signals.consecutiveFailures).toBe(0);
});

test("extracts OpenAI tool calls and results", () => {
  const rawBody = {
    messages: [
      { role: "user", content: "fix tests" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "edit_file",
              arguments: JSON.stringify({ path: "src/server.ts", content: "new code" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "Success",
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({ command: "pnpm test" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_2",
        content: "FAIL: test_server failed with code 1",
      },
    ],
  };

  const req: ChatRequest = {
    model: "test-model",
    messages: [
      { role: "user", content: "fix tests" },
      { role: "assistant", content: "" },
      { role: "tool", content: "Success" },
      { role: "assistant", content: "" },
      { role: "tool", content: "FAIL: test_server failed with code 1" },
    ],
    dialect: "openai",
    rawBody,
  };

  const signals = extractSignals(req);
  expect(signals.toolCalls).toHaveLength(2);
  expect(signals.toolCalls[0].name).toBe("edit_file");
  expect(signals.toolResults).toHaveLength(2);
  expect(signals.toolResults[1].isError).toBe(true);
  expect(signals.filesTouched).toEqual(["src/server.ts"]);
  expect(signals.hasTestFailures).toBe(true);
  expect(signals.consecutiveFailures).toBe(1); // last one failed, previous succeeded
});

test("extracts Anthropic tool calls and results", () => {
  const rawBody = {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_a1",
            name: "str_replace_editor",
            input: { path: "src/server.ts", replacement: "foo" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_a1",
            content: "Success replacing text",
            is_error: false,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_a2",
            name: "str_replace_editor",
            input: { path: "src/server.ts", replacement: "bar" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_a2",
            content: "Some compilation warning",
            is_error: true,
          },
        ],
      },
    ],
  };

  const req: ChatRequest = {
    model: "test-model",
    messages: [
      { role: "assistant", content: "" },
      { role: "user", content: "Success replacing text" },
      { role: "assistant", content: "" },
      { role: "user", content: "Some compilation warning" },
    ],
    dialect: "anthropic",
    rawBody,
  };

  const signals = extractSignals(req);
  expect(signals.toolCalls).toHaveLength(2);
  expect(signals.toolResults).toHaveLength(2);
  expect(signals.toolResults[1].isError).toBe(true);
  expect(signals.filesTouched).toEqual(["src/server.ts"]);
  expect(signals.repeatedEdits).toBe(true); // src/server.ts was edited twice in a row
  expect(signals.consecutiveFailures).toBe(1);
});

test("correctly calculates consecutive failures", () => {
  const rawBody = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "1", name: "tool1", input: {} },
          { type: "tool_use", id: "2", name: "tool2", input: {} },
          { type: "tool_use", id: "3", name: "tool3", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "1", content: "err1", is_error: true },
          { type: "tool_result", tool_use_id: "2", content: "err2", is_error: true },
          { type: "tool_result", tool_use_id: "3", content: "err3", is_error: true },
        ],
      },
    ],
  };

  const req: ChatRequest = {
    model: "test-model",
    messages: [
      { role: "assistant", content: "" },
      { role: "user", content: "" },
    ],
    dialect: "anthropic",
    rawBody,
  };

  const signals = extractSignals(req);
  expect(signals.consecutiveFailures).toBe(3);
});

test("does not flag benign words containing 'fail' as failures", () => {
  const rawBody = {
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "1", content: "failover completed; failsafe engaged" },
        ],
      },
    ],
  };

  const req: ChatRequest = {
    model: "test-model",
    messages: [{ role: "user", content: "" }],
    dialect: "anthropic",
    rawBody,
  };

  const signals = extractSignals(req);
  expect(signals.toolResults[0].isError).toBe(false);
  expect(signals.hasTestFailures).toBe(false);
  expect(signals.consecutiveFailures).toBe(0);
});

test("extracts OpenAI Responses API (input / function_call) signals", () => {
  const rawBody = {
    input: [
      {
        role: "developer",
        type: "message",
        content: [
          { type: "input_text", text: "sys content" }
        ]
      },
      {
        role: "user",
        type: "message",
        content: [
          { type: "input_text", text: "user prompt" }
        ]
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_abc123",
        name: "edit_file",
        arguments: JSON.stringify({ path: "src/server.ts" })
      },
      {
        type: "function_call_output",
        call_id: "call_abc123",
        output: "FAIL: compiler error"
      }
    ]
  };

  const req: ChatRequest = {
    model: "test-model",
    messages: [], // empty messages in responses proxy mode
    dialect: "openai",
    rawBody
  };

  const signals = extractSignals(req);
  expect(signals.totalMessages).toBe(4);
  expect(signals.totalCharacters).toBe(22); // "sys content" (11) + "user prompt" (11)
  expect(signals.toolCalls).toHaveLength(1);
  expect(signals.toolCalls[0].name).toBe("edit_file");
  expect(signals.toolResults).toHaveLength(1);
  expect(signals.toolResults[0].isError).toBe(true);
  expect(signals.filesTouched).toEqual(["src/server.ts"]);
  expect(signals.consecutiveFailures).toBe(1);
});

test("successful execution clears an earlier test failure", () => {
  const rawBody = {
    messages: [
      { role: "assistant", tool_calls: [{ type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "tool", content: "FAIL: tests failed" },
      { role: "assistant", tool_calls: [{ type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "tool", content: "Tests passed" },
    ],
  };

  const signals = extractSignals({
    model: "test-model",
    messages: [
      { role: "assistant", content: "" },
      { role: "tool", content: "FAIL: tests failed" },
      { role: "assistant", content: "" },
      { role: "tool", content: "Tests passed" },
    ],
    dialect: "openai",
    rawBody,
  });

  expect(signals.hasTestFailures).toBe(false);
  expect(signals.consecutiveFailures).toBe(0);
});

test("old repeated edits do not affect recent edit signals", () => {
  const oldEdits = [
    { role: "assistant", tool_calls: [{ type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "old.ts" }) } }] },
    { role: "assistant", tool_calls: [{ type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "old.ts" }) } }] },
  ];
  const recentReads = Array.from({ length: 8 }, (_, i) => ({
    role: "assistant",
    tool_calls: [{ type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `recent-${i}.ts` }) } }],
  }));

  const signals = extractSignals({
    model: "test-model",
    messages: [],
    dialect: "openai",
    rawBody: { messages: [...oldEdits, ...recentReads] },
  });

  expect(signals.toolCalls).toHaveLength(10);
  expect(signals.filesTouched).not.toContain("old.ts");
  expect(signals.repeatedEdits).toBe(false);
});

test("read-only tool success does NOT clear an earlier test failure", () => {
  const rawBody = {
    messages: [
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "FAIL: tests failed" },
      { role: "assistant", tool_calls: [{ id: "c2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c2", content: "content of file" },
    ],
  };

  const signals = extractSignals({
    model: "test-model",
    messages: [],
    dialect: "openai",
    rawBody,
  });

  expect(signals.hasTestFailures).toBe(true);
});

test("clears heuristics on new user task boundary (last message is user)", () => {
  const rawBody = {
    messages: [
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "FAIL: tests failed" },
      { role: "user", content: "Let's fix it by doing Y instead." },
    ],
  };

  const signals = extractSignals({
    model: "test-model",
    messages: [],
    dialect: "openai",
    rawBody,
  });

  // Since the last message is role: "user" (new user prompt/boundary), heuristics should be cleared
  expect(signals.hasTestFailures).toBe(false);
  expect(signals.consecutiveFailures).toBe(0);
});

test("retains heuristics during active agent loop (last message is tool result)", () => {
  const rawBody = {
    messages: [
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "FAIL: tests failed" },
    ],
  };

  const signals = extractSignals({
    model: "test-model",
    messages: [],
    dialect: "openai",
    rawBody,
  });

  // The last message is tool result (active loop), so heuristics should be retained
  expect(signals.hasTestFailures).toBe(true);
  expect(signals.consecutiveFailures).toBe(1);
});
