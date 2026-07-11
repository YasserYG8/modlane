import { expect, test } from "vitest";
import { parseEnv } from "./env.js";

test("parses standard key-value pairs", () => {
  const res = parseEnv("TEST_KEY=my-value");
  expect(res.TEST_KEY).toBe("my-value");
});

test("ignores comments and empty lines", () => {
  const res = parseEnv(`
    # This is a comment
    TEST_KEY=my-value

    # Another comment
    ANOTHER_KEY=value2
  `);
  expect(res.TEST_KEY).toBe("my-value");
  expect(res.ANOTHER_KEY).toBe("value2");
});

test("handles single and double quotes", () => {
  const res = parseEnv(`
    KEY1="double-quoted-value"
    KEY2='single-quoted-value'
  `);
  expect(res.KEY1).toBe("double-quoted-value");
  expect(res.KEY2).toBe("single-quoted-value");
});

test("keeps '=' inside values (e.g. base64 keys)", () => {
  const res = parseEnv("TOKEN=abc==def");
  expect(res.TOKEN).toBe("abc==def");
});
