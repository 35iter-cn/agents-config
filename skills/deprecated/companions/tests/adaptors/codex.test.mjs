import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexAdaptor } from '../../scripts/lib/adaptors/codex.mjs';

test('codex adaptor captures thread_id from thread.started event', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({ type: 'thread.started', thread_id: '019e7095-689b-78c1-895a-98ab0a695d9c' });
  assert.equal(adaptor.getSummary().sessionID, '019e7095-689b-78c1-895a-98ab0a695d9c');
});

test('codex adaptor does not overwrite existing sessionID', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({ type: 'thread.started', thread_id: 'first-id' });
  adaptor.push({ type: 'thread.started', thread_id: 'second-id' });
  assert.equal(adaptor.getSummary().sessionID, 'first-id');
});

test('codex adaptor captures final message from agent_message item', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'Hello, I have completed the task.' },
  });
  assert.equal(adaptor.getSummary().finalMessage, 'Hello, I have completed the task.');
});

test('codex adaptor replaces finalMessage on each new agent_message', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'First message' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: 'Second message' },
  });
  assert.equal(adaptor.getSummary().finalMessage, 'Second message');
});

test('codex adaptor finalMessage defaults to empty string', () => {
  const adaptor = createCodexAdaptor();
  assert.equal(adaptor.getSummary().finalMessage, '');
});

test('codex adaptor records command_execution item', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'command_execution', command: 'ls -la', aggregated_output: '', exit_code: null, status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: 'ls -la', aggregated_output: 'file1\nfile2\n', exit_code: 0, status: 'completed' },
  });
  const cmds = adaptor.getSummary().commandsExecuted;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, 'ls -la');
  assert.equal(cmds[0].status, 'completed');
  assert.ok(cmds[0].output.includes('file1'));
});

test('codex adaptor records failed command_execution', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'command_execution', command: 'invalid-cmd', aggregated_output: '', exit_code: null, status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: 'invalid-cmd', aggregated_output: 'command not found', exit_code: 127, status: 'failed' },
  });
  const cmds = adaptor.getSummary().commandsExecuted;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, 'invalid-cmd');
  assert.equal(cmds[0].status, 'error');
});

test('codex adaptor ignores in_progress command without completed event', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'command_execution', command: 'long-running', aggregated_output: '', exit_code: null, status: 'in_progress' },
  });
  assert.equal(adaptor.getSummary().commandsExecuted.length, 0);
});

test('codex adaptor records file changes from file_change item', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'file_change', changes: [], status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: {
      id: 'item_0',
      type: 'file_change',
      changes: [
        { path: 'src/new.js', kind: 'add' },
        { path: 'src/old.js', kind: 'delete' },
        { path: 'src/modified.js', kind: 'update' },
      ],
      status: 'completed',
    },
  });
  const mods = adaptor.getSummary().filesModified;
  assert.equal(mods.length, 3);
  assert.deepEqual(mods[0], { path: 'src/new.js', operation: 'add' });
  assert.deepEqual(mods[1], { path: 'src/old.js', operation: 'delete' });
  assert.deepEqual(mods[2], { path: 'src/modified.js', operation: 'update' });
});

test('codex adaptor extracts token usage from turn.completed', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'turn.completed',
    usage: { input_tokens: 150, cached_input_tokens: 50, output_tokens: 30, reasoning_output_tokens: 10 },
  });
  const usage = adaptor.getSummary().tokenUsage;
  assert.equal(usage.input, 150);
  assert.equal(usage.output, 30);
  assert.equal(usage.total, 180);
  assert.equal(usage.reasoning, 10);
  assert.equal(usage.cache.write, 50);
  assert.equal(usage.cache.read, 0);
});

test('codex adaptor records turn.failed as model error', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'turn.failed',
    error: { message: 'Missing environment variable: ANTHROPIC_AUTH_TOKEN.' },
  });
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'unknown');
  assert.equal(errors[0].name, 'TurnFailed');
});

test('codex adaptor classifies error events', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'error',
    message: 'Reconnecting... 1/5 (unexpected status 404 Not Found)',
  });
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'network_error');
});

test('codex adaptor validates session successfully', () => {
  const adaptor = createCodexAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-1');
  assert.equal(result, null);
});

test('codex adaptor detects session ID mismatch', () => {
  const adaptor = createCodexAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-2');
  assert.deepEqual(result, { type: 'mismatch', expected: 'sid-1', actual: 'sid-2' });
});

test('codex adaptor detects missing sessionID on resumption', () => {
  const adaptor = createCodexAdaptor();
  const result = adaptor.validateSession('', 'sid-1', undefined);
  assert.deepEqual(result, { type: 'missing', message: 'No sessionID returned during resumption' });
});

test('codex adaptor classifies stderr auth errors', () => {
  const adaptor = createCodexAdaptor();
  const result = adaptor.classifyStderr('Error: Missing environment variable: ANTHROPIC_AUTH_TOKEN.');
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'auth_error');
});

test('codex adaptor classifies stderr network errors', () => {
  const adaptor = createCodexAdaptor();
  const result = adaptor.classifyStderr('Error: ETIMEDOUT connection failed');
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'network_error');
});

test('codex adaptor invalid event does not throw', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push(null);
  adaptor.push(undefined);
  adaptor.push('not an object');
  adaptor.push(42);
  assert.equal(adaptor.getSummary().errors.length, 0);
});

test('codex adaptor handles full realistic event sequence', () => {
  const adaptor = createCodexAdaptor();

  // Session start
  adaptor.push({ type: 'thread.started', thread_id: 'thread-abc-123' });

  // Turn start
  adaptor.push({ type: 'turn.started' });

  // Agent runs a command
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'command_execution', command: 'ls', aggregated_output: '', exit_code: null, status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: 'ls', aggregated_output: 'README.md\n', exit_code: 0, status: 'completed' },
  });

  // Agent applies file changes
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_1', type: 'file_change', changes: [], status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_1', type: 'file_change', changes: [{ path: 'new-file.txt', kind: 'add' }], status: 'completed' },
  });

  // Agent responds
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_2', type: 'agent_message', text: 'Done! I created new-file.txt.' },
  });

  // Turn completes
  adaptor.push({
    type: 'turn.completed',
    usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50, reasoning_output_tokens: 5 },
  });

  const summary = adaptor.getSummary();
  assert.equal(summary.sessionID, 'thread-abc-123');
  assert.equal(summary.finalMessage, 'Done! I created new-file.txt.');
  assert.equal(summary.commandsExecuted.length, 1);
  assert.equal(summary.commandsExecuted[0].command, 'ls');
  assert.equal(summary.filesModified.length, 1);
  assert.equal(summary.filesModified[0].path, 'new-file.txt');
  assert.equal(summary.tokenUsage.input, 100);
  assert.equal(summary.tokenUsage.output, 50);
  assert.equal(summary.total, undefined); // not a field on summary
});

test('codex adaptor handles declined command execution', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.started',
    item: { id: 'item_0', type: 'command_execution', command: 'rm -rf /', aggregated_output: '', exit_code: null, status: 'in_progress' },
  });
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: 'rm -rf /', aggregated_output: '', exit_code: null, status: 'declined' },
  });
  const cmds = adaptor.getSummary().commandsExecuted;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, 'rm -rf /');
  assert.equal(cmds[0].status, 'error');
});

test('codex adaptor handles empty or missing command string', () => {
  const adaptor = createCodexAdaptor();
  adaptor.push({
    type: 'item.completed',
    item: { id: 'item_0', type: 'command_execution', command: '', aggregated_output: '', exit_code: 0, status: 'completed' },
  });
  assert.equal(adaptor.getSummary().commandsExecuted.length, 0);
});
