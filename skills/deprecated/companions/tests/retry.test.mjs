import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runCompanion } from '../scripts/lib/runner.mjs';
import {
  createOpencodeAdaptor,
} from '../scripts/lib/adaptors/opencode.mjs';
import {
  createCursorAdaptor,
  classifyCursorStderr,
} from '../scripts/lib/adaptors/cursor.mjs';

function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write() {},
    end() {},
  };
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.emit('close', null, signal);
    return true;
  };
  return child;
}

function createCapture() {
  const lines = [];
  return {
    lines,
    writeLine(line) {
      lines.push(line);
    },
  };
}

function parseEvents(lines) {
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

test('opencode adaptor classifies APIError 401 as auth_error from fixture', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-auth-error.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    adaptor.push(JSON.parse(line));
  }
  const summary = adaptor.getSummary();
  assert.equal(summary.modelErrors.length, 1);
  assert.equal(summary.modelErrors[0].class, 'auth_error');
  assert.equal(summary.modelErrors[0].statusCode, 401);
});

test('opencode adaptor classifies APIError 429 as rate_limited', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-rate-limited.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    adaptor.push(JSON.parse(line));
  }
  const summary = adaptor.getSummary();
  assert.equal(summary.modelErrors[0].class, 'rate_limited');
  assert.equal(summary.modelErrors[0].statusCode, 429);
});

test('opencode adaptor classifies APIError 5xx as network_error', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-server-error.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    adaptor.push(JSON.parse(line));
  }
  const summary = adaptor.getSummary();
  assert.equal(summary.modelErrors[0].class, 'network_error');
  assert.equal(summary.modelErrors[0].statusCode, 503);
});

test('opencode adaptor classifies UnknownError with model-not-found as model_unavailable', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-invalid-model.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    adaptor.push(JSON.parse(line));
  }
  const summary = adaptor.getSummary();
  assert.equal(summary.modelErrors[0].class, 'model_unavailable');
});

test('opencode adaptor: tool_use errors do not pollute modelErrors[]', () => {
  const adaptor = createOpencodeAdaptor();
  adaptor.push({
    type: 'tool_use',
    part: {
      type: 'tool',
      tool: 'bash',
      callID: 'c1',
      state: { status: 'error', input: { command: 'false' }, error: 'failed' },
    },
  });
  const summary = adaptor.getSummary();
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.modelErrors.length, 0);
});

test('opencode adaptor mid-task fixture has both modifications and model error', async () => {
  const raw = await readFile(new URL('./fixtures/opencode-mid-task-failure.jsonl', import.meta.url), 'utf8');
  const adaptor = createOpencodeAdaptor();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    adaptor.push(JSON.parse(line));
  }
  const summary = adaptor.getSummary();
  assert.equal(summary.filesModified.length, 1);
  assert.equal(summary.commandsExecuted.length, 1);
  assert.equal(summary.modelErrors.length, 1);
  assert.equal(summary.modelErrors[0].class, 'network_error');
});

test('classifyCursorStderr detects ECONNREFUSED as network_error', async () => {
  const raw = await readFile(new URL('./fixtures/cursor-network-error.stderr.txt', import.meta.url), 'utf8');
  const result = classifyCursorStderr(raw);
  assert.ok(result);
  assert.equal(result.class, 'network_error');
});

test('classifyCursorStderr detects "Cannot use this model" as model_unavailable', async () => {
  const raw = await readFile(new URL('./fixtures/cursor-invalid-model.stderr.txt', import.meta.url), 'utf8');
  const result = classifyCursorStderr(raw);
  assert.ok(result);
  assert.equal(result.class, 'model_unavailable');
});

test('classifyCursorStderr returns null for unrecognized stderr', () => {
  assert.equal(classifyCursorStderr('something random'), null);
  assert.equal(classifyCursorStderr(''), null);
  assert.equal(classifyCursorStderr(null), null);
});

test('cursor adaptor.classifyStderr appends to modelErrors[]', () => {
  const adaptor = createCursorAdaptor();
  adaptor.classifyStderr('Error: connect ECONNREFUSED');
  const summary = adaptor.getSummary();
  assert.equal(summary.modelErrors.length, 1);
  assert.equal(summary.modelErrors[0].class, 'network_error');
});

test('runCompanion: model_unavailable retries with lower tier (maximum→high→medium)', async () => {
  const spawns = [];
  const argsHistory = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      argsHistory.push(args);
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'UnknownError', data: { message: 'Model not found: xxx' } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
    resolveModel: () => undefined,
  });

  assert.equal(spawns.length, 3, 'Should attempt original + 2 retries before giving up at medium');
  assert.equal(argsHistory[0].includes('--model'), false);
  assert.equal(argsHistory[1].includes('--model'), false);
  assert.equal(argsHistory[2].includes('--model'), false);

  assert.equal(result.success, false);
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(
    result.attempts.map((a) => a.modelTier),
    ['maximum', 'high', 'medium'],
  );
  assert.equal(result.retryCount, 2);
  assert.equal(result.finalModelTier, 'medium');

  const events = parseEvents(cap.lines);
  assert.equal(events.filter((e) => e.type === 'started').length, 1);
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
  const retries = events.filter((e) => e.type === 'retry');
  assert.equal(retries.length, 2);
  assert.equal(retries[0].errorClass, 'model_unavailable');
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[1].attempt, 2);
});

test('runCompanion: model_unavailable from "low" tier does not retry (no lower tier)', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'low',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'UnknownError', data: { message: 'Model not found: xxx' } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.retryCount, 0);
});

test('runCompanion: auth_error does NOT trigger retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: {
                name: 'APIError',
                data: { message: 'Insufficient balance', statusCode: 401, isRetryable: false },
              },
            }) + '\n',
          ),
        );
        child.emit('close', 0);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1);
  assert.equal(result.attempts[0].errorClass, 'auth_error');
});

test('runCompanion: rate_limited retries with same model + backoff, eventual success', async () => {
  const spawns = [];
  const cap = createCapture();
  let calls = 0;

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'medium',
    heartbeatIntervalMs: 9999,
    retryBackoffMs: 5,
    resolveModel: () => undefined,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      calls += 1;
      const isLast = calls === 3;
      setImmediate(() => {
        if (isLast) {
          child.emit('close', 0);
        } else {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                type: 'error',
                error: {
                  name: 'APIError',
                  data: { message: 'Too many requests', statusCode: 429 },
                },
              }) + '\n',
            ),
          );
          child.emit('close', 1);
        }
      });
      return child;
    },
  });

  assert.equal(spawns.length, 3);
  for (const s of spawns) {
    assert.equal(s.args.includes('--model'), false);
  }
  assert.equal(result.success, true);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts[0].errorClass, 'rate_limited');
  assert.equal(result.attempts[2].success, true);

  const events = parseEvents(cap.lines);
  assert.equal(events.filter((e) => e.type === 'started').length, 1);
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
  const retries = events.filter((e) => e.type === 'retry');
  assert.equal(retries.length, 2);
  assert.equal(retries[0].errorClass, 'rate_limited');
});

test('runCompanion: network_error (5xx) retries with same model up to max', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'high',
    heartbeatIntervalMs: 9999,
    retryBackoffMs: 5,
    resolveModel: () => undefined,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'APIError', data: { message: 'Upstream', statusCode: 502 } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 3, 'Should retry up to max');
  for (const s of spawns) {
    assert.equal(s.args.includes('--model'), false);
  }
  assert.equal(result.attempts[0].errorClass, 'network_error');
  assert.equal(result.success, false);
  assert.equal(result.retryCount, 2);
});

test('runCompanion: model error with file modifications does NOT trigger retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'tool_use',
              part: {
                type: 'tool',
                tool: 'write',
                callID: 'c1',
                state: { status: 'completed', input: { filePath: '/tmp/a.txt' } },
              },
            }) + '\n' +
              JSON.stringify({
                type: 'error',
                error: { name: 'UnknownError', data: { message: 'Model not found: xxx' } },
              }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1, 'No retry when files already modified');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.filesModified.length, 1);

  const events = parseEvents(cap.lines);
  assert.equal(events.filter((e) => e.type === 'retry').length, 0);
});

test('runCompanion: model error with executed commands does NOT trigger retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'tool_use',
              part: {
                type: 'tool',
                tool: 'bash',
                callID: 'c1',
                state: { status: 'completed', input: { command: 'ls' }, output: '...' },
              },
            }) + '\n' +
              JSON.stringify({
                type: 'error',
                error: { name: 'APIError', data: { statusCode: 502, message: 'bad gateway' } },
              }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1, 'No retry when commands already executed');
  assert.equal(result.commandsExecuted.length, 1);
});

test('runCompanion: tool_use error does NOT trigger retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'tool_use',
              part: {
                type: 'tool',
                tool: 'read',
                callID: 'c1',
                state: { status: 'error', input: { filePath: '/missing' }, error: 'ENOENT' },
              },
            }) + '\n',
          ),
        );
        child.emit('close', 2);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1, 'Tool errors should not retry');
  assert.equal(result.errors.length, 1);
  assert.equal(result.modelErrors.length, 0);
});

test('runCompanion: command_not_found (process_error) does NOT retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        const err = new Error('spawn opencode ENOENT');
        err.code = 'ENOENT';
        child.emit('error', err);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1, 'process_error must not retry');
  assert.equal(result.attempts[0].errorClass, 'process_error');
});

test('runCompanion: unknown model error class does NOT retry', async () => {
  const spawns = [];
  const cap = createCapture();

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'WeirdError', data: { message: 'something off' } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  assert.equal(spawns.length, 1);
  assert.equal(result.attempts[0].errorClass, 'unknown');
});

test('runCompanion: cursor stderr ECONNREFUSED triggers network_error retry', async () => {
  const spawns = [];
  const cap = createCapture();
  let calls = 0;

  const result = await runCompanion('cursor', 'do task', {
    modelTier: 'medium',
    heartbeatIntervalMs: 9999,
    retryBackoffMs: 5,
    writeLine: cap.writeLine,
    spawnImpl(command, args) {
      spawns.push({ command, args });
      const child = createMockChild();
      calls += 1;
      const succeed = calls === 2;
      setImmediate(() => {
        if (succeed) {
          child.emit('close', 0);
        } else {
          child.stderr.emit('data', Buffer.from('Error: [unavailable] connect ECONNREFUSED 127.0.0.1:1\n'));
          child.emit('close', 1);
        }
      });
      return child;
    },
  });

  assert.equal(spawns.length, 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].errorClass, 'network_error');
  assert.equal(result.attempts[1].success, true);
  assert.equal(result.success, true);

  const events = parseEvents(cap.lines);
  const retries = events.filter((e) => e.type === 'retry');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].errorClass, 'network_error');
});

test('runCompanion: retry event carries correct attempt number, model, errorClass', async () => {
  const cap = createCapture();

  await runCompanion('opencode', 'do task', {
    modelTier: 'high',
    heartbeatIntervalMs: 9999,
    resolveModel: () => undefined,
    writeLine: cap.writeLine,
    spawnImpl() {
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'UnknownError', data: { message: 'Model not found: zz' } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  const events = parseEvents(cap.lines);
  const retries = events.filter((e) => e.type === 'retry');
  assert.equal(retries.length, 2);
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[0].errorClass, 'model_unavailable');
  assert.equal(retries[0].model, 'medium');
  assert.equal(retries[1].attempt, 2);
  assert.equal(retries[1].model, 'low');
});

test('runCompanion: summary.attempts records every attempt with mixed outcomes', async () => {
  const cap = createCapture();
  let calls = 0;

  const result = await runCompanion('opencode', 'do task', {
    modelTier: 'maximum',
    heartbeatIntervalMs: 9999,
    writeLine: cap.writeLine,
    spawnImpl() {
      const child = createMockChild();
      calls += 1;
      const succeed = calls === 3;
      setImmediate(() => {
        if (succeed) {
          child.emit('close', 0);
        } else {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                type: 'error',
                error: { name: 'UnknownError', data: { message: 'Model not found: x' } },
              }) + '\n',
            ),
          );
          child.emit('close', 1);
        }
      });
      return child;
    },
  });

  assert.equal(result.attempts.length, 3);
  assert.deepEqual(
    result.attempts.map((a) => ({ tier: a.modelTier, success: a.success, klass: a.errorClass })),
    [
      { tier: 'maximum', success: false, klass: 'model_unavailable' },
      { tier: 'high', success: false, klass: 'model_unavailable' },
      { tier: 'medium', success: true, klass: null },
    ],
  );
  assert.equal(result.success, true);
  assert.equal(result.finalModelTier, 'medium');
  assert.equal(result.retryCount, 2);
});

test('runCompanion: heartbeat continues across retry attempts', async () => {
  const cap = createCapture();
  let calls = 0;

  await runCompanion('opencode', 'do task', {
    modelTier: 'high',
    heartbeatIntervalMs: 30,
    retryBackoffMs: 5,
    writeLine: cap.writeLine,
    spawnImpl() {
      const child = createMockChild();
      calls += 1;
      const succeed = calls === 2;
      const interval = setInterval(() => {
        child.stdout.emit('data', Buffer.from('keepalive\n'));
      }, 10);
      setTimeout(() => {
        clearInterval(interval);
        if (succeed) {
          child.emit('close', 0);
        } else {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                type: 'error',
                error: { name: 'APIError', data: { statusCode: 502, message: 'bad gateway' } },
              }) + '\n',
            ),
          );
          child.emit('close', 1);
        }
      }, 100);
      return child;
    },
  });

  const events = parseEvents(cap.lines);
  const heartbeats = events.filter((e) => e.type === 'heartbeat');
  assert.ok(heartbeats.length >= 3, `expected multiple heartbeats across retries, got ${heartbeats.length}`);
});

test('runCompanion: dryRun path still works (no started emitted, single done)', async () => {
  const cap = createCapture();

  const result = await runCompanion('opencode', 'demo', {
    dryRun: true,
    modelTier: 'high',
    writeLine: cap.writeLine,
  });

  assert.equal(result.success, true);
  const events = parseEvents(cap.lines);
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
});

test('runCompanion: emits exactly one started and one done across all retries', async () => {
  const cap = createCapture();

  await runCompanion('opencode', 'do task', {
    modelTier: 'high',
    heartbeatIntervalMs: 9999,
    retryBackoffMs: 5,
    writeLine: cap.writeLine,
    spawnImpl() {
      const child = createMockChild();
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              type: 'error',
              error: { name: 'APIError', data: { statusCode: 502, message: 'x' } },
            }) + '\n',
          ),
        );
        child.emit('close', 1);
      });
      return child;
    },
  });

  const events = parseEvents(cap.lines);
  assert.equal(events.filter((e) => e.type === 'started').length, 1);
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
});
