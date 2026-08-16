import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpencodeAdaptor } from '../../scripts/lib/adaptors/opencode.mjs';

test('opencode validateSession detects "Session not found" in stderr', () => {
  const adaptor = createOpencodeAdaptor();
  const result = adaptor.validateSession('Error: Session not found', 'sid-1', 'sid-1');
  assert.deepEqual(result, { type: 'not_found', message: 'Session not found' });
});

test('opencode validateSession returns null when session is valid', () => {
  const adaptor = createOpencodeAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-1');
  assert.equal(result, null);
});

test('opencode validateSession detects session ID mismatch', () => {
  const adaptor = createOpencodeAdaptor();
  const result = adaptor.validateSession('', 'sid-1', 'sid-2');
  assert.deepEqual(result, { type: 'mismatch', expected: 'sid-1', actual: 'sid-2' });
});

test('opencode validateSession detects missing sessionID on resumption', () => {
  const adaptor = createOpencodeAdaptor();
  const result = adaptor.validateSession('', 'sid-1', undefined);
  assert.deepEqual(result, { type: 'missing', message: 'No sessionID returned during resumption' });
});

test('opencode adaptor aggregates streaming text fragments by messageID', () => {
  const adaptor = createOpencodeAdaptor();
  adaptor.push({ type: 'text', part: { text: 'Hello ', messageID: 'msg-1' } });
  adaptor.push({ type: 'text', part: { text: 'world', messageID: 'msg-1' } });
  assert.equal(adaptor.getSummary().finalMessage, 'Hello world');
});

test('opencode adaptor resets finalMessage on new messageID', () => {
  const adaptor = createOpencodeAdaptor();
  adaptor.push({ type: 'text', part: { text: 'First turn ', messageID: 'msg-1' } });
  adaptor.push({ type: 'text', part: { text: 'Second turn', messageID: 'msg-2' } });
  assert.equal(adaptor.getSummary().finalMessage, 'Second turn');
});

test('opencode adaptor handles text events without messageID', () => {
  const adaptor = createOpencodeAdaptor();
  adaptor.push({ type: 'text', part: { text: 'chunk1' } });
  adaptor.push({ type: 'text', part: { text: 'chunk2' } });
  assert.equal(adaptor.getSummary().finalMessage, 'chunk1chunk2');
});

test('opencode adaptor finalMessage defaults to empty string', () => {
  const adaptor = createOpencodeAdaptor();
  assert.equal(adaptor.getSummary().finalMessage, '');
});
