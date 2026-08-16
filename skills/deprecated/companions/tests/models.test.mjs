import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getModels, resetModels } from '../scripts/lib/models.mjs';

test('getModels returns full config when no adaptor specified', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = getModels(undefined, configPath);
  assert.deepEqual(result, { opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' }, codex: {} });
});

test('getModels returns only requested adaptor with other empty', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = getModels('opencode', configPath);
  assert.deepEqual(result, { opencode: { low: 'a' }, cursor: {}, omp: {}, codex: {} });
});

test('getModels returns empty config for missing file', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'nonexistent.json');

  const result = getModels(undefined, configPath);
  assert.deepEqual(result, { opencode: {}, cursor: {}, omp: {}, codex: {} });
});

test('resetModels clears single adaptor', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = resetModels('opencode', configPath);
  assert.equal(result.success, true);

  const after = getModels(undefined, configPath);
  assert.deepEqual(after, { opencode: {}, cursor: { low: 'b' }, omp: { low: 'c' }, codex: {} });
});

test('resetModels clears both adaptors when adaptor omitted', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = resetModels(undefined, configPath);
  assert.equal(result.success, true);

  const after = getModels(undefined, configPath);
  assert.deepEqual(after, { opencode: {}, cursor: {}, omp: {}, codex: {} });
});

test('resetModels returns error for invalid adaptor', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: {}, cursor: {}, omp: {} }));

  const result = resetModels('invalid', configPath);
  assert.equal(result.success, false);
  assert.match(result.error, /Unsupported adaptor/);
});

test('getModels returns omp config when requested', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = getModels('omp', configPath);
  assert.deepEqual(result, { opencode: {}, cursor: {}, omp: { low: 'c' }, codex: {} });
});

test('resetModels clears omp independently', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-test-'));
  const configPath = join(tmpDir, 'model-map.json');
  writeFileSync(configPath, JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' }, omp: { low: 'c' } }));

  const result = resetModels('omp', configPath);
  assert.equal(result.success, true);

  const after = getModels(undefined, configPath);
  assert.deepEqual(after, { opencode: { low: 'a' }, cursor: { low: 'b' }, omp: {}, codex: {} });
});
