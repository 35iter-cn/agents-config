#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./push-branch.mjs', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function setupRepoWithRemote(base) {
  const remote = join(base, 'remote.git');
  git(['init', '--bare', remote], base);

  const local = join(base, 'local');
  mkdirSync(local, { recursive: true });
  git(['init', '--initial-branch=main'], local);
  git(['config', 'user.email', 'test@test.com'], local);
  git(['config', 'user.name', 'Test'], local);
  writeFileSync(join(local, 'README.md'), '# init\n');
  git(['add', '-A'], local);
  git(['commit', '-m', 'initial'], local);
  git(['remote', 'add', 'origin', remote], local);
  git(['push', '-u', 'origin', 'main'], local);

  return { remote, local };
}

test('push-branch sets upstream for first push', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'push-test-'));
  try {
    const { local } = setupRepoWithRemote(tmp);
    git(['checkout', '-b', 'feature'], local);
    writeFileSync(join(local, 'feat.txt'), 'feature work\n');
    git(['add', '-A'], local);
    git(['commit', '-m', 'add feature'], local);

    const out = execFileSync(SCRIPT, [], { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /RESULT: pushed/);
    assert.match(out, /Strategy: set-upstream/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('push-branch uses force-with-lease for existing upstream', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'push-test-'));
  try {
    const { local } = setupRepoWithRemote(tmp);
    git(['checkout', '-b', 'feature'], local);
    writeFileSync(join(local, 'feat.txt'), 'feature work\n');
    git(['add', '-A'], local);
    git(['commit', '-m', 'add feature'], local);
    // First push to establish upstream
    git(['push', '--set-upstream', 'origin', 'feature'], local);

    // Second push should use force-with-lease
    const out = execFileSync(SCRIPT, [], { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /RESULT: pushed/);
    assert.match(out, /Strategy: force-with-lease/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('push-branch exits 2 when remote has new commits', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'push-test-'));
  try {
    const { local, remote } = setupRepoWithRemote(tmp);
    git(['checkout', '-b', 'feature'], local);
    writeFileSync(join(local, 'feat.txt'), 'feature work\n');
    git(['add', '-A'], local);
    git(['commit', '-m', 'add feature'], local);
    git(['push', '--set-upstream', 'origin', 'feature'], local);

    // Simulate another clone pushing to the same branch
    const other = join(tmp, 'other');
    git(['clone', remote, other], tmp);
    git(['checkout', 'feature'], other);
    writeFileSync(join(other, 'other.txt'), 'other work\n');
    git(['add', '-A'], other);
    git(['commit', '-m', 'other commit'], other);
    git(['push', 'origin', 'feature'], other);

    // Now local push should fail with exit 2
    let out = '';
    let exitCode = 0;
    try {
      out = execFileSync(SCRIPT, [], { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
      out = e.stdout ? e.stdout.trim() : '';
      exitCode = e.status;
    }
    assert.strictEqual(exitCode, 2);
    assert.match(out, /RESULT: failed/);
    assert.match(out, /远程分支有新提交/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
