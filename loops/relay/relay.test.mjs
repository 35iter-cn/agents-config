import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEnv } from "./relay.mjs";

test("readEnv parses KEY=value lines and ignores comments", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-env-"));
  const file = join(dir, "feishu.env");
  writeFileSync(file, "# comment\nFEISHU_APP_ID=cli_123\nFEISHU_APP_SECRET=spaced \ninvalid line\n FOO=  indented\nBAR=\n");
  assert.deepEqual(readEnv(file), { FEISHU_APP_ID: "cli_123", FEISHU_APP_SECRET: "spaced", BAR: "" });
});

test("readEnv returns an empty object for a missing file", () => {
  assert.deepEqual(readEnv("/nonexistent/feishu.env"), {});
});
