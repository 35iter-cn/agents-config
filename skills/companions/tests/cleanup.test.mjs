import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupAgentshubLogs, _internals } from '../scripts/lib/cleanup.mjs';

function newName(i) {
  const hhmm = `10:${String(30 + i).padStart(2, '0')}`;
  const rand = `cafe${String(i).padStart(2, '0')}`;
  return `2026-05-21-${hhmm}-${rand}.jsonl`;
}

function createTestFile(dir, name, mtimeDaysAgo, offsetMs = 0) {
  const path = join(dir, name);
  writeFileSync(path, '');
  const now = Date.now();
  const mtime = new Date(now - mtimeDaysAgo * 24 * 60 * 60 * 1000 + offsetMs);
  utimesSync(path, mtime, mtime);
  return name;
}

test('空目录返回空结果', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const result = await cleanupAgentshubLogs({ dir });
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.errors, []);
});

test('目录不存在返回空结果', async () => {
  const dir = join(tmpdir(), `cleanup-test-nonexistent-${Date.now()}`);
  const result = await cleanupAgentshubLogs({ dir });
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.errors, []);
});

test('无匹配文件不删除任何文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  writeFileSync(join(dir, 'other-file.txt'), 'data');

  const result = await cleanupAgentshubLogs({ dir });
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.errors, []);
});

test('按时间删除超期文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const now = new Date();

  const oldFile = createTestFile(dir, '2026-05-21-10:30-a1b2c3d4.jsonl', 5);
  const newFile = createTestFile(dir, '2026-05-21-10:31-b2c3d4e5.jsonl', 1);

  const result = await cleanupAgentshubLogs({ dir, now });

  assert.deepEqual(result.deleted, [oldFile]);
  assert.deepEqual(result.kept, [newFile]);
  assert.deepEqual(result.errors, []);
});

test('按数量删除保留最新20个', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const now = new Date();

  const files = [];
  for (let i = 0; i < 25; i++) {
    const name = newName(i);
    createTestFile(dir, name, 1, i * 1000);
    files.push(name);
  }

  const result = await cleanupAgentshubLogs({ dir, now });

  assert.equal(result.deleted.length, 5);
  assert.equal(result.kept.length, 20);
  assert.ok(result.kept.includes(newName(24)));
  assert.ok(result.deleted.includes(newName(0)));
});

test('混合策略同时验证时间和数量', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const now = new Date();

  for (let i = 0; i < 30; i++) {
    const daysAgo = i < 5 ? 5 : 1;
    createTestFile(dir, newName(i), daysAgo);
  }

  const result = await cleanupAgentshubLogs({ dir, now });

  assert.equal(result.deleted.length, 10);
  assert.equal(result.kept.length, 20);
});

test('跳过非文件条目', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const now = new Date();

  mkdirSync(join(dir, '2026-05-21-10:30-a1b2c3d4.jsonl'));
  const fileName = createTestFile(dir, '2026-05-21-10:31-b2c3d4e5.jsonl', 1);

  const result = await cleanupAgentshubLogs({ dir, now });

  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.kept, [fileName]);
  assert.deepEqual(result.errors, []);
});

test('删除容错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  const now = new Date();

  const file1 = createTestFile(dir, '2026-05-21-10:30-a1b2c3d4.jsonl', 5);
  const file2 = createTestFile(dir, '2026-05-21-10:31-b2c3d4e5.jsonl', 5);

  const originalUnlink = _internals.unlink;
  _internals.unlink = async (path) => {
    if (path === join(dir, file1)) {
      throw new Error('EPERM: simulated unlink failure');
    }
    return originalUnlink(path);
  };

  try {
    const result = await cleanupAgentshubLogs({ dir, now });

    assert.ok(result.deleted.includes(file2));
    assert.ok(result.errors.some((e) => e.file === file1));
    assert.ok(result.errors.some((e) => e.error.includes('EPERM')));
  } finally {
    _internals.unlink = originalUnlink;
    try { await originalUnlink(join(dir, file1)); } catch {}
  }
});
