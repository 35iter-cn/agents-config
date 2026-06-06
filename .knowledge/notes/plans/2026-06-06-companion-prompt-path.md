# companion CLI --prompt-path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `run` to `launch`, add `--prompt-path` as the required prompt input mechanism, and remove positional argument and stdin input modes.

**Architecture:** Parse `--prompt-path` explicitly in `parseRunArguments()`, validate its presence in the `launch` branch of `main()`, read the file via `readFileSync`, and delegate the prompt string to `runCompanion` as before. `models --set` continues to use `readStdin()` unchanged.

**Tech Stack:** Node.js native (`node:fs`, `node:test`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/companions/scripts/lib/companion.mjs` | Modify | CLI argument parsing, command dispatch, help text, file I/O |
| `skills/companions/tests/opencode-companion.test.mjs` | Modify | Unit tests for argument parsing and command dispatch |

---

### Task 1: Rename `run` to `launch` in `parseRunArguments` tests and add `--prompt-path` parsing test

**Files:**
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Update existing `parseRunArguments` tests to use `--prompt-path` and remove positional prompt assertions**

Replace the existing test `parseRunArguments keeps prompt and parses companion flag`:

```javascript
test('parseRunArguments parses --prompt-path and companion flag', () => {
  const result = parseRunArguments([
    '--prompt-path',
    '/tmp/prompt.txt',
    '--companion',
    'reviewer',
  ]);

  assert.deepEqual(result, {
    promptPath: '/tmp/prompt.txt',
    companion: 'reviewer',
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  });
});
```

Replace `parseRunArguments parses all supported --modelTier tiers` — each assertion must use `--prompt-path` instead of positional prompt:

```javascript
test('parseRunArguments parses all supported --modelTier tiers', () => {
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'low']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'low',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'medium']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'medium',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'high']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'high',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'maximum']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'maximum',
    dryRun: false,
    session: undefined,
  });
});
```

Replace `parseRunArguments leaves modelTier undefined when --modelTier is omitted`:

```javascript
test('parseRunArguments leaves modelTier undefined when --modelTier is omitted', () => {
  const result = parseRunArguments(['--prompt-path', 'task.txt']);
  assert.equal(result.modelTier, undefined);
  assert.equal(result.promptPath, 'task.txt');
});
```

Replace `parseRunArguments parses --dry-run flag`:

```javascript
test('parseRunArguments parses --dry-run flag', () => {
  const result = parseRunArguments(['--prompt-path', 'ship.txt', '--dry-run']);

  assert.deepEqual(result, {
    promptPath: 'ship.txt',
    companion: undefined,
    modelTier: undefined,
    dryRun: true,
    session: undefined,
  });
});
```

Replace `parseRunArguments parses --session flag`:

```javascript
test('parseRunArguments parses --session flag', () => {
  const result = parseRunArguments([
    '--prompt-path',
    'continue.txt',
    '--session',
    'sid-abc-123',
  ]);

  assert.deepEqual(result, {
    promptPath: 'continue.txt',
    companion: undefined,
    modelTier: undefined,
    dryRun: false,
    session: 'sid-abc-123',
  });
});
```

Replace `parseRunArguments parses --session alongside --companion and --modelTier`:

```javascript
test('parseRunArguments parses --session alongside --companion and --modelTier', () => {
  const result = parseRunArguments([
    '--prompt-path',
    'do-work.txt',
    '--companion', 'cursor',
    '--modelTier', 'high',
    '--session', 'sid-xyz',
  ]);

  assert.deepEqual(result, {
    promptPath: 'do-work.txt',
    companion: 'cursor',
    modelTier: 'high',
    dryRun: false,
    session: 'sid-xyz',
  });
});
```

- [ ] **Step 2: Delete the stdin reading test**

Delete the entire test block: `main reads prompt from stdin when no positional arg and stdin has data`

- [ ] **Step 3: Run tests to confirm they fail (parseRunArguments has no promptPath field yet)**

Run:
```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: FAIL — tests reference `promptPath` but `parseRunArguments` still returns `prompt`

- [ ] **Step 4: Update `parseRunArguments` in `companion.mjs`**

In `skills/companions/scripts/lib/companion.mjs`, replace the function:

```javascript
export function parseRunArguments(args) {
  const result = {
    promptPath: undefined,
    companion: undefined,
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '--companion') {
      result.companion = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--modelTier') {
      result.modelTier = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--dry-run') {
      result.dryRun = true;
      continue;
    }

    if (current === '--session') {
      result.session = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--prompt-path') {
      result.promptPath = args[index + 1];
      index += 1;
      continue;
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify parseRunArguments tests pass**

Run:
```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: PASS for `parseRunArguments` tests; other tests may still fail due to `run` vs `launch`

---

### Task 2: Update help text and rename `run` to `launch` in main()

**Files:**
- Modify: `skills/companions/scripts/lib/companion.mjs`
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Update help text and command matching in `main()`**

In `skills/companions/scripts/lib/companion.mjs`, replace the `HELP_TEXT` and command check:

```javascript
  const HELP_TEXT = `Usage: companion <command> [options]

Commands:
  launch                 Launch a companion agent to process the prompt
  models                 Manage model configurations

Launch options:
  --prompt-path <path>   Path to the prompt file (required)
  --companion <name>     Companion type (opencode, cursor, omp, codex)
  --modelTier <tier>     Model tier (low, medium, high, maximum)
  --session <id>         Resume an existing session
  --dry-run              Show what would run without executing

Models options:
  --list                 List configured and available models
  --get [adaptor]        Get model configuration
  --set                  Set model configuration (reads JSON from stdin)
  --reset [adaptor]      Reset model configuration to defaults
`;
```

Change `if (command !== 'run')` to `if (command !== 'launch')`.

- [ ] **Step 2: Update help-related tests**

In `tests/opencode-companion.test.mjs`, update all help assertions:

For `main prints help and exits zero for --help`:
Replace `assert.match(output, /run \[prompt\]/);` with `assert.match(output, /--prompt-path/);`
Replace `assert.match(output, /--companion/);` and `assert.match(output, /--modelTier/);` remain.
Add: `assert.match(output, /launch/);`

For `main prints help for -h`:
Add: `assert.match(output, /launch/);`

For `main prints help for run --help`:
Rename test to `main prints help for launch --help`.
Change `await main(['run', '--help'], ...)` to `await main(['launch', '--help'], ...)`.

- [ ] **Step 3: Run tests**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: PASS for help tests; `launch` dispatch tests still fail because `run` is hardcoded in test inputs

---

### Task 3: Update all `run` dispatch tests to use `launch`

**Files:**
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Update `main dispatches run subcommand` test**

Rename to `main dispatches launch subcommand and exits zero on success`.
Change input from `['run', 'do work', '--companion', 'plan']` to `['launch', '--prompt-path', 'prompt.txt', '--companion', 'plan']`.
Update assertion: `prompt` field becomes `promptPath` in options; assert that `prompt` passed to `runOpencode` is the file contents.

Because the test mocks `runOpencode`, we need to also mock `readFileSync` or provide a `readPromptFile` dep.

**Better approach:** Add a `readPromptFile` dependency injection to `main()` so tests don't need real files.

In `main()` signature, add `readPromptFile` dep:
```javascript
export async function main(argv, deps = {}) {
```

Then in the launch branch:
```javascript
  const readPromptFile = deps.readPromptFile
    ?? ((path) => readFileSync(path, 'utf-8').trimEnd());
```

Update the test:
```javascript
test('main dispatches launch subcommand and exits zero on success', async () => {
  const exits = [];
  const calls = [];
  const result = {
    success: true,
    exitCode: 0,
    finalMessage: 'done',
  };

  const code = await main(
    ['launch', '--prompt-path', 'prompt.txt', '--companion', 'plan'],
    {
      runOpencode: async (prompt, options) => {
        calls.push({ prompt, options });
        return result;
      },
      exit(code) {
        exits.push(code);
      },
      readPromptFile: () => 'do work',
    },
  );

  assert.deepEqual(calls, [
    {
      prompt: 'do work',
      options: {
        companion: 'plan',
        modelTier: undefined,
        dryRun: false,
        session: undefined,
      },
    },
  ]);
  assert.deepEqual(exits, [0]);
  assert.equal(code, 0);
});
```

- [ ] **Step 2: Update `main exits non-zero when runOpencode fails`**

Rename to `main exits non-zero when launch fails`.
Change input: `['launch', '--prompt-path', 'demo.txt']`.
Add `readPromptFile: () => 'demo prompt'` to deps.

- [ ] **Step 3: Update `main passes dryRun`**

Change input: `['launch', '--prompt-path', 'work.txt', '--dry-run']`.
Add `readPromptFile: () => 'do work'`.

- [ ] **Step 4: Update `main passes requested agent type to runCompanion`**

Change input: `['launch', '--prompt-path', 'work.txt', '--companion', 'cursor']`.
Add `readPromptFile: () => 'do work'`.

- [ ] **Step 5: Update `main passes modelTier`**

Change input: `['launch', '--prompt-path', 'work.txt', '--modelTier', 'high']`.
Add `readPromptFile: () => 'do work'`.

- [ ] **Step 6: Update `main passes session option to runCompanion`**

Change input: `['launch', '--prompt-path', 'task.txt', '--session', 'sid-123']`.
Add `readPromptFile: () => 'resume task'`.

- [ ] **Step 7: Run tests to verify launch dispatch tests pass**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: All existing modified tests PASS

---

### Task 4: Add `--prompt-path` validation and file error tests (TDD)

**Files:**
- Modify: `skills/companions/scripts/lib/companion.mjs`
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Write failing test for missing `--prompt-path`**

Add to `tests/opencode-companion.test.mjs`:

```javascript
test('main requires --prompt-path and exits non-zero when missing', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['launch'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 1);
  assert.deepEqual(exits, [1]);
  assert.match(writes.join(''), /--prompt-path is required/);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: FAIL — new test fails because `launch` without `--prompt-path` currently passes `undefined` prompt to runner

- [ ] **Step 3: Add `--prompt-path` validation in `main()`**

In `skills/companions/scripts/lib/companion.mjs`, in the `launch` branch (after `const parsed = parseRunArguments(args);`):

```javascript
  const readPromptFile = deps.readPromptFile
    ?? ((path) => readFileSync(path, 'utf-8').trimEnd());

  if (!parsed.promptPath) {
    stdoutWrite('Error: --prompt-path is required\n');
    exit(1);
    return 1;
  }

  let prompt;
  try {
    prompt = readPromptFile(parsed.promptPath);
  } catch (error) {
    stdoutWrite(`Error: cannot read prompt file: ${error.message}\n`);
    exit(1);
    return 1;
  }
```

Also add `readFileSync` import at the top:
```javascript
import { readFileSync } from 'node:fs';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: PASS

- [ ] **Step 5: Write failing test for nonexistent prompt file**

```javascript
test('main exits non-zero when prompt file does not exist', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['launch', '--prompt-path', '/nonexistent/prompt.txt'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 1);
  assert.deepEqual(exits, [1]);
  const output = writes.join('');
  assert.match(output, /cannot read prompt file/);
  assert.match(output, /ENOENT/);
});
```

- [ ] **Step 6: Run test to confirm it passes (implementation already handles this)**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: PASS

---

### Task 5: Add test for successful file reading with `--prompt-path`

**Files:**
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Write test for reading prompt from file**

```javascript
test('main reads prompt from file when --prompt-path is provided', async () => {
  const calls = [];
  const exits = [];

  const code = await main(
    ['launch', '--prompt-path', 'my-prompt.txt'],
    {
      runCompanion: async (agentType, prompt, options) => {
        calls.push({ agentType, prompt, options });
        return { success: true };
      },
      exit: (value) => exits.push(value),
      readPromptFile: () => 'file contents here',
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'file contents here');
  assert.equal(calls[0].agentType, 'opencode');
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/opencode-companion.test.mjs
```

Expected: PASS

---

### Task 6: Clean up old `run` references and run full test suite

**Files:**
- Modify: `skills/companions/scripts/lib/companion.mjs`
- Modify: `skills/companions/tests/opencode-companion.test.mjs`

- [ ] **Step 1: Remove dead `run` branch logic**

In `companion.mjs`, the old `run` branch that handled positional prompt and stdin is already replaced by the `launch` branch. Confirm the old code is gone:

Old code to remove (if any remnants remain after Task 3):
```javascript
  let prompt = parsed.prompt;
  const hasStdinData = deps.stdinHasData ?? stdinHasData;
  if (prompt === undefined && hasStdinData()) {
    prompt = await readStdin();
  }
```

This should already be replaced by the file-reading logic from Task 4.

- [ ] **Step 2: Run the full companion test suite**

```bash
cd /root/agents-for-myself/skills/companions && node --test tests/**/*.test.mjs
```

Expected: ALL PASS

If any test in `tests/adaptors/` or `tests/runner.test.mjs` references `run` command or `prompt` field, fix them.

- [ ] **Step 3: Commit**

```bash
git add skills/companions/scripts/lib/companion.mjs

git add skills/companions/tests/opencode-companion.test.mjs

git commit -m "feat(companion): rename run to launch, add --prompt-path, remove stdin/positional input

- Rename subcommand: run → launch
- Add --prompt-path as required prompt input (replaces positional arg)
- Remove stdin pipe reading from launch branch
- models --set continues to use stdin (unchanged)
- Update all tests to match new interface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Plan Task |
|-----------------|-----------|
| `run` → `launch` 重命名 | Task 2, 3 |
| 新增 `--prompt-path <path>` | Task 1, 4, 5 |
| 移除位置参数 `[prompt]` | Task 1 (parseRunArguments 不再读取位置参数) |
| 移除 `launch` 的 stdin 读取 | Task 4 (替换为文件读取) |
| `models --set` 保留 stdin | 未修改相关代码 |
| help 文本更新 | Task 2 |
| 缺少 `--prompt-path` 报错 | Task 4 |
| 文件读取错误处理 | Task 4 |
| 测试更新 | Task 1-6 |

**Coverage: 100%** — 所有 spec 要求都有对应任务。

### Placeholder Scan

- No TBD/TODO/"implement later"
- No vague "add appropriate error handling" — exact error messages specified
- No "write tests for the above" — every test has actual code
- No "similar to Task N" references

### Type Consistency

- `parseRunArguments` returns `promptPath` (not `prompt`) — consistent across all tasks
- `main()` uses `readPromptFile` dep injection — consistent in tests and implementation
- `launch` command string used throughout — no `run` remnants

---

## Execution Handoff

**Plan complete and saved to `.knowledge/notes/plans/2026-06-06-companion-prompt-path.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
