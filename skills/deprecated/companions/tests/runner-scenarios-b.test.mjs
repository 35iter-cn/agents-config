import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createSummaryCollector, runOpencode } from '../scripts/lib/runner.mjs';
import { createOpencodeAdaptor } from '../scripts/lib/adaptors/opencode.mjs';
import { createCursorAdaptor } from '../scripts/lib/adaptors/cursor.mjs';
import { resolveModelFromConfig, getModels, resetModels } from '../scripts/lib/models.mjs';

function createMockChild({ onKill } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    onKill?.(signal);
    child.emit('close', null, signal);
    return true;
  };
  return child;
}
test('runCompanion emits started notification as first stdout line (not heartbeat)', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  const { runCompanion } = await import('../scripts/lib/runner.mjs');

  try {
    let mockChild;
    const resultPromise = runCompanion('opencode', 'test prompt', {
      heartbeatIntervalMs: 9999999,
      spawnImpl() {
        mockChild = createMockChild();
        return mockChild;
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    const firstLine = writes[0];
    assert.ok(firstLine, 'Should have emitted at least one line');
    const first = JSON.parse(firstLine);
    assert.equal(first.type, 'started', 'First message must be type: started');
    assert.match(first.message, /agent: opencode/, 'Message must include agent name');
    assert.match(first.message, /model: auto/, 'Message must include model (auto when no tier)');

    mockChild.emit('close', 0);
    await resultPromise;
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion started notification includes resolved model when modelTier provided', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  const { runCompanion } = await import('../scripts/lib/runner.mjs');

  try {
    let mockChild2;
    const resultPromise = runCompanion('opencode', 'test prompt', {
      modelTier: 'medium',
      heartbeatIntervalMs: 9999999,
      resolveModel: () => undefined,
      spawnImpl() {
        mockChild2 = createMockChild();
        return mockChild2;
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    const firstLine = writes[0];
    const first = JSON.parse(firstLine);
    assert.equal(first.type, 'started');
    assert.match(first.message, /model: auto/);

    mockChild2.emit('close', 0);
    await resultPromise;
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('resolveModelFromConfig handles missing config without throwing', () => {
  assert.equal(resolveModelFromConfig(undefined, 'low'), undefined);
  assert.equal(resolveModelFromConfig(null, 'low'), undefined);
});

test('getModels returns empty config when file is missing', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'nonexistent.json');
  const result = getModels(undefined, configPath);
  assert.deepEqual(result, { opencode: {}, cursor: {}, omp: {}, codex: {} });
});

test('resetModels succeeds when file is missing', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'nonexistent.json');
  const result = resetModels('opencode', configPath);
  assert.equal(result.success, true);
});

test('createCursorAdaptor parses real cursor-runx-implementation fixture', async () => {
  const raw = await readFile(new URL('./fixtures/cursor-runx-implementation.jsonl', import.meta.url), 'utf8');
  const adaptor = createCursorAdaptor();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      adaptor.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }

  const summary = adaptor.getSummary();
  assert.ok(summary.filesRead.length > 0, 'Should have read files');
  assert.ok(summary.filesModified.length > 0, 'Should have modified files');
  assert.ok(summary.commandsExecuted.length > 0, 'Should have executed commands');
  assert.deepEqual(summary.errors, [], 'Should have no errors in a successful session');
  assert.ok(summary.finalMessage.length > 0, 'Should have final messages');
  assert.ok(summary.tokenUsage.total > 0, 'Should have token usage');
});

test('createCursorAdaptor parses real cursor-simple-chat fixture', async () => {
  const raw = await readFile(new URL('./fixtures/cursor-simple-chat.jsonl', import.meta.url), 'utf8');
  const adaptor = createCursorAdaptor();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      adaptor.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }

  const summary = adaptor.getSummary();
  assert.equal(summary.filesRead.length, 0, 'Chat has no file reads');
  assert.equal(summary.filesModified.length, 0, 'Chat has no file modifications');
  assert.equal(summary.commandsExecuted.length, 0, 'Chat has no commands');
  assert.deepEqual(summary.errors, [], 'Chat has no errors');
  assert.ok(summary.finalMessage.length > 0, 'Chat should have assistant message');
  assert.ok(summary.tokenUsage.total > 0, 'Chat should have token usage');
});

test('createOpencodeAdaptor parses real opencode-error-bash fixture', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-error-bash.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      adaptor.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }

  const summary = adaptor.getSummary();
  assert.deepEqual(summary.commandsExecuted, [{ command: 'exit 2', status: 'error' }]);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].tool, 'bash');
  assert.equal(summary.errors[0].error, 'failed');
});

test('createOpencodeAdaptor parses real opencode-simple-chat fixture', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-simple-chat.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      adaptor.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }

  const summary = adaptor.getSummary();
  assert.equal(summary.filesRead.length, 0, 'Chat has no file reads');
  assert.equal(summary.filesModified.length, 0, 'Chat has no file modifications');
  assert.equal(summary.commandsExecuted.length, 0, 'Chat has no commands');
  assert.deepEqual(summary.errors, [], 'Chat has no errors');
  assert.ok(summary.finalMessage.length > 0, 'Chat should have assistant message');
  assert.ok(summary.finalMessage.includes('特朗普'), 'Message should contain expected content');
  assert.ok(summary.tokenUsage.total > 0, 'Chat should have token usage');
  assert.equal(summary.tokenUsage.input, 12872);
  assert.equal(summary.tokenUsage.output, 1013);
});

test('runCompanion dryRun includes --session for opencode when session provided', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('opencode', 'resume task', {
      dryRun: true,
      session: 'sid-123',
    });

    assert.equal(result.success, true);
    assert.match(
      result.commandsExecuted[0].command,
      /--session sid-123/,
      'Should include --session in opencode command',
    );
    assert.equal(result.sessionID, 'sid-123', 'Dry-run should pass through sessionID');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion dryRun includes --resume for cursor when session provided', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk.toString());
    return true;
  };

  try {
    const { runCompanion } = await import('../scripts/lib/runner.mjs');
    const result = await runCompanion('cursor', 'resume task', {
      dryRun: true,
      session: 'sid-456',
    });

    assert.equal(result.success, true);
    assert.match(
      result.commandsExecuted[0].command,
      /--resume sid-456/,
      'Should include --resume in cursor command',
    );
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('runCompanion dryRun does not add --session when not provided', async () => {
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('opencode', 'normal task', {
    dryRun: true,
  });

  assert.doesNotMatch(
    result.commandsExecuted[0].command,
    /--session/,
    'Should not include --session when not provided',
  );
});

test('runSingleAttempt calls validateSession when session is provided', async () => {
  const { EventEmitter } = await import('node:events');
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('opencode', 'resume task', {
    session: 'sid-123',
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write() {}, end() {} };
      child.killed = false;
      child.kill = () => {};
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(
          JSON.stringify({ sessionID: 'sid-123', type: 'text', part: { text: 'resuming' } }) + '\n',
        ));
        child.stderr.emit('data', Buffer.from(''));
        child.emit('close', 0);
      }, 10);
      return child;
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionError, undefined, 'validateSession should pass with matching sessionID');
});

test('runSingleAttempt sets sessionError when validateSession fails', async () => {
  const { EventEmitter } = await import('node:events');
  const { runCompanion } = await import('../scripts/lib/runner.mjs');
  const result = await runCompanion('opencode', 'resume task', {
    session: 'sid-123',
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write() {}, end() {} };
      child.killed = false;
      child.kill = () => {};
      setTimeout(() => {
        child.stderr.emit('data', Buffer.from(''));
        child.emit('close', 0);
      }, 10);
      return child;
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.sessionError, { type: 'missing', message: 'No sessionID returned during resumption' });
});
