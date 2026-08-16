import test from 'node:test';
import assert from 'node:assert/strict';
import { createCursorAdaptor, classifyCursorStderr } from '../../scripts/lib/adaptors/cursor.mjs';

test('cursor validateSession detects session ID mismatch', () => {
  const adaptor = createCursorAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-2');
  assert.deepEqual(result, { type: 'mismatch', expected: 'sid-1', actual: 'sid-2' });
});

test('cursor validateSession returns null when session is valid', () => {
  const adaptor = createCursorAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-1');
  assert.equal(result, null);
});

test('cursor validateSession detects missing sessionID on resumption', () => {
  const adaptor = createCursorAdaptor();
  const result = adaptor.validateSession('', 'sid-1', undefined);
  assert.deepEqual(result, { type: 'missing', message: 'No sessionID returned during resumption' });
});

test('cursor adaptor reads session_id (snake_case) from events', () => {
  const adaptor = createCursorAdaptor();
  adaptor.push({ session_id: 'cursor-session-456', type: 'tool_call', subtype: 'completed', tool_call: {} });
  assert.equal(adaptor.getSummary().sessionID, 'cursor-session-456');
});

test('cursor adaptor replaces finalMessage on each new assistant event', () => {
  const adaptor = createCursorAdaptor();
  adaptor.push({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'First message' }] },
  });
  assert.equal(adaptor.getSummary().finalMessage, 'First message');
  adaptor.push({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Second message' }] },
  });
  assert.equal(adaptor.getSummary().finalMessage, 'Second message');
});

test('cursor adaptor finalMessage defaults to empty string', () => {
  const adaptor = createCursorAdaptor();
  assert.equal(adaptor.getSummary().finalMessage, '');
});

test('cursor classifyStderr identifies usage limit as model_unavailable', () => {
  const stderr = `You've hit your usage limit. You've saved $52 on API model usage this month with Pro. Switch to a different model or set a Spend Limit to continue with this model.`;
  const result = classifyCursorStderr(stderr);
  assert.equal(result.class, 'model_unavailable');
  assert.ok(result.message.includes('usage limit'));
});

test('cursor adaptor classifyStderr pushes usage limit to modelErrors', () => {
  const adaptor = createCursorAdaptor();
  const stderr = 'You\'ve hit your usage limit. Switch to a different model to continue.';
  adaptor.classifyStderr(stderr);
  const errors = adaptor.getSummary().modelErrors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].class, 'model_unavailable');
});

test('cursor classifyStderr returns null for unrecognized stderr', () => {
  const result = classifyCursorStderr('some random error message');
  assert.equal(result, null);
});
