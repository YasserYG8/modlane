import { expect, test } from "vitest";

// A small wrapper around our loader logic to test it
function simulateEnvLoad(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

test("parses standard key-value pairs", () => {
  const res = simulateEnvLoad("TEST_KEY=my-value");
  expect(res.TEST_KEY).toBe("my-value");
});

test("ignores comments and empty lines", () => {
  const res = simulateEnvLoad(`
    # This is a comment
    TEST_KEY=my-value
    
    # Another comment
    ANOTHER_KEY=value2
  `);
  expect(res.TEST_KEY).toBe("my-value");
  expect(res.ANOTHER_KEY).toBe("value2");
});

test("handles single and double quotes", () => {
  const res = simulateEnvLoad(`
    KEY1="double-quoted-value"
    KEY2='single-quoted-value'
  `);
  expect(res.KEY1).toBe("double-quoted-value");
  expect(res.KEY2).toBe("single-quoted-value");
});
