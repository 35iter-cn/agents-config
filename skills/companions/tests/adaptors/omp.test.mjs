import test from 'node:test';
import assert from 'node:assert/strict';
import { createOmpAdaptor, classifyOmpStderr } from '../../scripts/lib/adaptors/omp.mjs';

test('omp adaptor extracts sessionID from session event', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({ type: 'session', version: 3, id: '019e-1234', timestamp: '...', cwd: '/' });
  assert.equal(adaptor.getSummary().sessionID, '019e-1234');
});

test('omp adaptor only captures first sessionID', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({ type: 'session', id: 'session-a' });
  adaptor.push({ type: 'session', id: 'session-b' });
  assert.equal(adaptor.getSummary().sessionID, 'session-a');
});

test('omp adaptor extracts finalMessage from assistant message_end', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello! ' },
        { type: 'text', text: 'How can I help?' },
      ],
    },
  });
  assert.equal(adaptor.getSummary().finalMessage, 'Hello! How can I help?');
});

test('omp adaptor finalMessage defaults to empty string', () => {
  const adaptor = createOmpAdaptor();
  assert.equal(adaptor.getSummary().finalMessage, '');
});

test('omp adaptor ignores non-assistant message_end for finalMessage', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'message_end',
    message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    usage: { input: 10, output: 5 },
  });
  assert.equal(adaptor.getSummary().finalMessage, '');
});

test('omp adaptor extracts token usage from message_end', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'message_end',
    message: { role: 'assistant', content: [] },
    usage: {
      input: 100,
      output: 50,
      totalTokens: 150,
      reasoningTokens: 20,
      cacheWrite: 30,
      cacheRead: 40,
    },
  });
  assert.deepEqual(adaptor.getSummary().tokenUsage, {
    input: 100,
    output: 50,
    total: 150,
    reasoning: 20,
    cache: { write: 30, read: 40 },
  });
});

test('omp adaptor handles zero token usage gracefully', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'message_end',
    message: { role: 'assistant', content: [] },
    usage: {},
  });
  assert.deepEqual(adaptor.getSummary().tokenUsage, {
    input: 0,
    output: 0,
    total: 0,
    reasoning: 0,
    cache: { write: 0, read: 0 },
  });
});

test('omp adaptor tracks bash tool execution', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'bash',
    args: { command: 'echo hello' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'bash',
    result: { content: [{ type: 'text', text: 'hello\n' }], isError: false },
    isError: false,
  });
  const cmds = adaptor.getSummary().commandsExecuted;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, 'echo hello');
  assert.equal(cmds[0].status, 'completed');
  assert.ok(cmds[0].output.includes('hello'));
});

test('omp adaptor tracks read tool execution', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-r1',
    toolName: 'read',
    args: { path: '/tmp/test.txt' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-r1',
    toolName: 'read',
    result: { isError: false },
    isError: false,
  });
  const files = adaptor.getSummary().filesRead;
  assert.equal(files.length, 1);
  assert.equal(files[0].path, '/tmp/test.txt');
  assert.equal(files[0].status, 'completed');
});

test('omp adaptor tracks edit and write tool execution', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-e1',
    toolName: 'edit',
    args: { path: 'src/main.ts' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-e1',
    toolName: 'edit',
    result: { isError: false },
    isError: false,
  });
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-w1',
    toolName: 'write',
    args: { path: 'dist/out.js' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-w1',
    toolName: 'write',
    result: { isError: false },
    isError: false,
  });
  const modified = adaptor.getSummary().filesModified;
  assert.equal(modified.length, 2);
  assert.equal(modified[0].path, 'src/main.ts');
  assert.equal(modified[0].operation, 'edit');
  assert.equal(modified[1].path, 'dist/out.js');
  assert.equal(modified[1].operation, 'write');
});

test('omp adaptor tracks tool errors', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-err',
    toolName: 'bash',
    args: { command: 'invalid_cmd' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-err',
    toolName: 'bash',
    result: { error: 'command not found', isError: true },
    isError: true,
  });
  const errors = adaptor.getSummary().errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].tool, 'bash');
  assert.equal(errors[0].error, 'command not found');
  assert.equal(errors[0].callID, 'call-err');
  const cmds = adaptor.getSummary().commandsExecuted;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].status, 'error');
});

test('omp adaptor tracks tool errors via result.isError', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_start',
    toolCallId: 'call-err2',
    toolName: 'read',
    args: { path: 'missing.txt' },
  });
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'call-err2',
    toolName: 'read',
    result: { isError: true, error: 'file not found' },
    isError: false,
  });
  const errors = adaptor.getSummary().errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, 'file not found');
});

test('omp adaptor handles tool execution without prior start event', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'tool_execution_end',
    toolCallId: 'orphan',
    toolName: 'bash',
    result: { isError: false },
    isError: false,
  });
  assert.equal(adaptor.getSummary().commandsExecuted.length, 1);
  assert.equal(adaptor.getSummary().commandsExecuted[0].command, '');
});

test('omp adaptor ignores null and non-object events', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push(null);
  adaptor.push(undefined);
  adaptor.push('string');
  adaptor.push(42);
  assert.equal(adaptor.getSummary().finalMessage, '');
  assert.equal(adaptor.getSummary().commandsExecuted.length, 0);
});

test('omp adaptor ignores unknown event types', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({ type: 'turn_start' });
  adaptor.push({ type: 'agent_start' });
  adaptor.push({ type: 'turn_end' });
  adaptor.push({ type: 'agent_end' });
  assert.equal(adaptor.getSummary().finalMessage, '');
  assert.equal(adaptor.getSummary().commandsExecuted.length, 0);
});

test('omp validateSession detects session ID mismatch', () => {
  const adaptor = createOmpAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-2');
  assert.deepEqual(result, { type: 'mismatch', expected: 'sid-1', actual: 'sid-2' });
});

test('omp validateSession returns null when session is valid', () => {
  const adaptor = createOmpAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-1');
  assert.equal(result, null);
});

test('omp validateSession detects missing sessionID on resumption', () => {
  const adaptor = createOmpAdaptor();
  const result = adaptor.validateSession('', 'sid-1', undefined);
  assert.deepEqual(result, { type: 'missing', message: 'No sessionID returned during resumption' });
});

test('omp classifyStderr identifies usage limit as model_unavailable', () => {
  const stderr = "You've hit your usage limit. Upgrade your plan to continue.";
  const result = classifyOmpStderr(stderr);
  assert.equal(result.class, 'model_unavailable');
  assert.ok(result.message.includes('usage limit'));
});

test('omp adaptor classifyStderr pushes usage limit to modelErrors', () => {
  const adaptor = createOmpAdaptor();
  adaptor.classifyStderr('You\'ve hit your usage limit. Switch to a different model to continue.');
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'model_unavailable');
});

test('omp classifyStderr returns null for unrecognized stderr', () => {
  const result = classifyOmpStderr('some random error message');
  assert.equal(result, null);
});

test('omp classifyStderr returns null for empty stderr', () => {
  assert.equal(classifyOmpStderr(''), null);
  assert.equal(classifyOmpStderr('   '), null);
  assert.equal(classifyOmpStderr(undefined), null);
});

test('omp classifyStderr identifies auth errors', () => {
  const result = classifyOmpStderr('unauthorized: API key invalid');
  assert.equal(result.class, 'auth_error');
});

test('omp classifyStderr identifies network errors', () => {
  const result = classifyOmpStderr('Error: connect ECONNREFUSED 127.0.0.1:443');
  assert.equal(result.class, 'network_error');
});

test('omp adaptor resolveModel delegates to centralized resolveModel', () => {
  const adaptor = createOmpAdaptor();
  // resolveModel returns undefined for unconfigured tiers; only checks delegation works
  const result = adaptor.resolveModel('nonexistent_tier');
  assert.equal(result, undefined);
});

test('omp adaptor handles multi-turn session with multiple assistant messages', () => {
  const adaptor = createOmpAdaptor();
  adaptor.push({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'First response' }] },
  });
  adaptor.push({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Second response' }] },
  });
  // finalMessage tracks the last assistant message
  assert.equal(adaptor.getSummary().finalMessage, 'Second response');
});
