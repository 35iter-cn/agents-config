import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "prompts", name), "utf8");

function section(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

test("TC-P1 candidate rules open with a bold lead-in and carry no heading of their own", () => {
  const text = read("candidate-rules.md");
  assert.doesNotMatch(text, /^#/m);
  assert.match(text, /^\*\*候选任务\*\*/);
});

test("TC-P2 stdout is defined in exactly one line", () => {
  const text = read("thread.md");
  assert.equal(text.split("\n").filter((line) => line.includes("stdout")).length, 1);
});

test("TC-P3 boundary section holds four bullets with no repeated rule", () => {
  const bullets = section(read("thread.md"), "边界").split("\n").filter((line) => line.startsWith("- "));
  assert.equal(bullets.length, 4);
  assert.equal(bullets.filter((line) => line.includes("Slack")).length, 1);
  assert.equal(bullets.filter((line) => /再发一遍|再往群里发一遍/.test(line)).length, 1);
});

test("TC-P4 long text lands in a topic, not in the log directory", () => {
  const text = read("thread.md");
  assert.doesNotMatch(text, /log_dir|logs\//);
  assert.match(text, /using-topicbox/);
  assert.match(text, /topicbox artifact-create/);
});

test("TC-P5 stall actions are a fragment with no heading of their own", () => {
  const text = read("stall-actions.md");
  assert.doesNotMatch(text, /^#/m);
  assert.match(text, /^- 「杀掉」/);
});

test("TC-P6 both templates pull the stall actions from that one fragment", () => {
  const fragment = read("stall-actions.md");
  assert.match(fragment, /stall \{\{platform\}\} cancel/);
  assert.match(fragment, /stall \{\{platform\}\} restart/);
  for (const name of ["thread.md", "stall.md"]) {
    const text = read(name);
    assert.equal(text.split("{{stall_actions}}").length - 1, 1, `${name} must carry the placeholder once`);
    assert.doesNotMatch(text, /stall \{\{platform\}\} (cancel|restart|resume)/, `${name} must not restate the commands`);
  }
});
