#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./detect-lmb.mjs', import.meta.url).pathname;

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

  // Ensure bare remote HEAD points to the branch we pushed
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);

  return { remote, local };
}

test('detect-lmb outputs remote/branch when single remote exists', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'detect-lmb-test-'));
  try {
    const { local } = setupRepoWithRemote(tmp);
    const out = execFileSync(SCRIPT, [], { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.strictEqual(out, 'origin/main');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detect-lmb with explicit REMOTE argument works', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'detect-lmb-test-'));
  try {
    const { local } = setupRepoWithRemote(tmp);
    const out = execFileSync(SCRIPT, ['origin'], { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.strictEqual(out, 'origin/main');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detect-lmb exits 1 when no remote exists', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'detect-lmb-test-'));
  try {
    git(['init', '--initial-branch=main'], tmp);

    let exitCode = 0;
    try {
      execFileSync(SCRIPT, [], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      exitCode = e.status;
    }
    assert.strictEqual(exitCode, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('detect-lmb exits 1 when multiple remotes exist', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'detect-lmb-test-'));
  try {
    const { local } = setupRepoWithRemote(tmp);
    // Add a second remote
    const remote2 = join(tmp, 'remote2.git');
    git(['init', '--bare', remote2], tmp);
    git(['remote', 'add', 'upstream', remote2], local);

    let exitCode = 0;
    try {
      execFileSync(SCRIPT, [], { cwd: local, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      exitCode = e.status;
    }
    assert.strictEqual(exitCode, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
