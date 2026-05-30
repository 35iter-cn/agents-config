import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createSummaryCollector, runOpencode } from '../scripts/lib/runner.mjs';
import {
  createOpencodeAdaptor,
} from '../scripts/lib/adaptors/opencode.mjs';
import {
  createOmpAdaptor,
} from '../scripts/lib/adaptors/omp.mjs';
import {
  createCursorAdaptor,
} from '../scripts/lib/adaptors/cursor.mjs';
import { resolveModelFromConfig, getModels, resetModels } from '../scripts/lib/models.mjs';

test('package.json keeps the planned plugin identity for project bootstrap', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.name, 'companions');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.scripts?.test, 'node --test');
});


test('resolveModelFromConfig returns model for configured tier', () => {
  assert.equal(resolveModelFromConfig({ low: 'a', medium: 'b' }, 'low'), 'a');
  assert.equal(resolveModelFromConfig({ low: 'a', medium: 'b' }, 'medium'), 'b');
});

test('resolveModelFromConfig returns undefined for missing tier', () => {
  assert.equal(resolveModelFromConfig({ low: 'a' }, 'medium'), undefined);
});

test('resolveModelFromConfig returns undefined for invalid config', () => {
  assert.equal(resolveModelFromConfig(null, 'low'), undefined);
  assert.equal(resolveModelFromConfig([], 'low'), undefined);
});

test('resolveModelFromConfig returns undefined for null/undefined tier', () => {
  assert.equal(resolveModelFromConfig({ low: 'a' }, undefined), undefined);
  assert.equal(resolveModelFromConfig({ low: 'a' }, null), undefined);
});

test('createOpencodeAdaptor resolveModel delegates to centralized resolveModel', () => {
  const adaptor = createOpencodeAdaptor();
  // undefined/null tier short-circuits before file read — always returns undefined
  assert.equal(adaptor.resolveModel(undefined), undefined);
  assert.equal(adaptor.resolveModel(null), undefined);
  // 'bogus' is not a real tier name
  assert.equal(adaptor.resolveModel('bogus'), undefined);
});

test('createCursorAdaptor resolveModel delegates to centralized resolveModel', () => {
  const adaptor = createCursorAdaptor();
  // undefined/null tier short-circuits before file read — always returns undefined
  assert.equal(adaptor.resolveModel(undefined), undefined);
  assert.equal(adaptor.resolveModel(null), undefined);
  // 'bogus' is not a real tier name
  assert.equal(adaptor.resolveModel('bogus'), undefined);
});

test('createOpencodeAdaptor maps tool, text and token events into summary', () => {
  const adaptor = createOpencodeAdaptor();
  adaptor.push({
    sessionID: 'session-top-level',
    type: 'tool_use',
    part: {
      type: 'tool',
      tool: 'read',
      state: { status: 'completed', input: { filePath: '/tmp/a.txt' } },
    },
  });
  adaptor.push({
    type: 'text',
    part: { text: 'final response' },
  });
  adaptor.push({
    type: 'step_finish',
    part: { tokens: { input: 1, output: 2, total: 3, reasoning: 0, cache: { write: 0, read: 0 } } },
  });

  assert.equal(adaptor.getSummary().sessionID, 'session-top-level');
  assert.deepEqual(adaptor.getSummary().filesRead, [{ path: '/tmp/a.txt', status: 'completed' }]);
  assert.equal(adaptor.getSummary().finalMessage, 'final response');
  assert.equal(adaptor.getSummary().tokenUsage.total, 3);
});

test('createCursorAdaptor maps completed tool calls, assistant text and usage', () => {
  const adaptor = createCursorAdaptor();

  adaptor.push({
    type: 'tool_call',
    subtype: 'completed',
    tool_call: {
      readToolCall: {
        args: { path: '/tmp/read-me.md' },
        result: { success: { content: 'hello' } },
      },
    },
  });
  adaptor.push({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'cursor says hi' },
      ],
    },
  });
  adaptor.push({
    type: 'result',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    },
  });

  const summary = adaptor.getSummary();
  assert.deepEqual(summary.filesRead, [{ path: '/tmp/read-me.md', status: 'completed' }]);
  assert.equal(summary.finalMessage, 'cursor says hi');
  assert.deepEqual(summary.tokenUsage, {
    input: 10,
    output: 5,
    total: 15,
    reasoning: 0,
    cache: { write: 1, read: 2 },
  });
});

test('runCompanion dryRun omits --model for opencode when tier is unconfigured', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('opencode', 'demo prompt', {
      dryRun: true,
      modelTier: 'high',
      resolveModel: () => undefined,
    });

    assert.equal(result.success, true);
    assert.equal(
      result.commandsExecuted[0].command,
      'opencode run --format json',
    );
    const commandLine = writes.find((line) => line.startsWith('opencode run'));
    assert.doesNotMatch(commandLine, /--model/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion dryRun omits medium model in opencode command when unconfigured', async () => {
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('opencode', 'demo prompt', {
    dryRun: true,
    modelTier: 'medium',
    resolveModel: () => undefined,
  });

  assert.equal(
    result.commandsExecuted[0].command,
    'opencode run --format json',
  );
});

test('runCompanion dryRun omits --model in cursor command when tier is unconfigured', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('cursor', 'demo prompt', {
      dryRun: true,
      modelTier: 'high',
      resolveModel: () => undefined,
    });

    assert.equal(result.success, true);
    assert.equal(
      result.commandsExecuted[0].command,
      'agent --print --output-format stream-json --trust --force',
    );
    const commandLine = writes.find((line) => line.startsWith('agent '));
    assert.doesNotMatch(commandLine, /--model/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion dryRun omits maximum model in cursor command when unconfigured', async () => {
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('cursor', 'demo prompt', {
    dryRun: true,
    modelTier: 'maximum',
    resolveModel: () => undefined,
  });

  assert.equal(
    result.commandsExecuted[0].command,
    'agent --print --output-format stream-json --trust --force',
  );
});

test('runCompanion dryRun prints cursor command and returns unified done marker', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('cursor', 'demo prompt', {
      dryRun: true,
      stdin: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.commandsExecuted[0].command, 'agent --print --output-format stream-json --trust --force');
    assert.equal(typeof result.logPath, 'string');

    const doneLines = writes.filter((line) => line.includes('"type":"done"'));
    assert.equal(doneLines.length, 1);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion uses cursor agent config and writes prompt to stdin', async () => {
  const spawns = [];
  const stdinWrites = [];

  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const resultPromise = runCompanion('cursor', 'demo prompt', {
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return {
        stdout: { on() {} },
        stderr: { on() {} },
        stdin: {
          write(chunk) { stdinWrites.push(chunk.toString()); },
          end() { stdinWrites.push('__EOF__'); },
        },
        on(event, handler) {
          if (event === 'close') setTimeout(() => handler(0), 0);
          if (event === 'error') {}
        },
      };
    },
  });

  const result = await resultPromise;
  assert.deepEqual(spawns[0], {
    command: 'agent',
    args: ['--print', '--output-format', 'stream-json', '--trust', '--force'],
    options: { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  });
  assert.deepEqual(stdinWrites, ['demo prompt', '__EOF__']);
  assert.equal(result.success, true);
});


test('createOmpAdaptor resolveModel delegates to centralized resolveModel', () => {
  const adaptor = createOmpAdaptor();
  assert.equal(adaptor.resolveModel(undefined), undefined);
  assert.equal(adaptor.resolveModel(null), undefined);
  assert.equal(adaptor.resolveModel('bogus'), undefined);
});

test('createOmpAdaptor maps session, tool execution and token events into summary', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({ type: 'session', version: 3, id: 'omp-session-001' });
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'read',
    args: { path: '/tmp/read-me.md' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'read',
    result: { isError: false },
    isError: false,
  });
  adaptor.push({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'omp says hi' }] },
    usage: { input: 20, output: 10, totalTokens: 30 },
  });

  const summary = adaptor.getSummary();
  assert.equal(summary.sessionID, 'omp-session-001');
  assert.deepEqual(summary.filesRead, [{ path: '/tmp/read-me.md', status: 'completed' }]);
  assert.equal(summary.finalMessage, 'omp says hi');
  assert.deepEqual(summary.tokenUsage, {
    input: 20,
    output: 10,
    total: 30,
    reasoning: 0,
    cache: { write: 0, read: 0 },
  });
});

test('runCompanion dryRun omits --model in omp command when tier is unconfigured', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('omp', 'demo prompt', {
      dryRun: true,
      modelTier: 'high',
      resolveModel: () => undefined,
    });

    assert.equal(result.success, true);
    assert.equal(
      result.commandsExecuted[0].command,
      'omp -p --mode json demo prompt',
    );
    const commandLine = writes.find((line) => line.startsWith('omp '));
    assert.doesNotMatch(commandLine, /--model/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion dryRun includes --model in omp command when tier configured', async () => {
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('omp', 'demo prompt', {
    dryRun: true,
    resolveModel: () => 'deepseek/deepseek-v4-flash',
  });

  assert.equal(
    result.commandsExecuted[0].command,
    'omp -p --mode json --model deepseek/deepseek-v4-flash demo prompt',
  );
});

test('runCompanion dryRun includes --resume in omp command when session provided', async () => {
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('omp', 'demo prompt', {
    dryRun: true,
    session: '019e-session-abc',
  });

  assert.equal(
    result.commandsExecuted[0].command,
    'omp -p --mode json --resume 019e-session-abc demo prompt',
  );
});

test('runCompanion uses omp agent config with useStdin false (prompt as arg not stdin)', async () => {
  const spawns = [];

  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const resultPromise = runCompanion('omp', 'demo prompt', {
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return {
        stdout: { on() {} },
        stderr: { on() {} },
        stdin: {
          write() {},
          end() {},
        },
        on(event, handler) {
          if (event === 'close') setTimeout(() => handler(0), 0);
          if (event === 'error') {}
        },
      };
    },
  });

  const result = await resultPromise;
  // Prompt must be the last arg, not written to stdin
  assert.equal(spawns[0].command, 'omp');
  assert.deepEqual(spawns[0].args.slice(-1), ['demo prompt']);
  // useStdin: false → stdio should be ['ignore', 'pipe', 'pipe']
  assert.deepEqual(spawns[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(result.success, true);
});