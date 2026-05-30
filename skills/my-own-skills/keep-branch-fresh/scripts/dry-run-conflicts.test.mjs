import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./dry-run-conflicts.mjs', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function setupRepo(base) {
  git(['init', '--initial-branch=main'], base);
  git(['config', 'user.email', 'test@test.com'], base);
  git(['config', 'user.name', 'Test'], base);
  writeFileSync(join(base, 'README.md'), '# base\n');
  git(['add', '-A'], base);
  git(['commit', '-m', 'initial'], base);
}

function createBranch(base, name, file, content) {
  git(['checkout', '-b', name], base);
  writeFileSync(join(base, file), content);
  git(['add', '-A'], base);
  git(['commit', '-m', `add ${file}`], base);
}

test('dry-run-conflicts reports clean for up-to-date branch', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dryrun-test-'));
  try {
    setupRepo(tmp);
    createBranch(tmp, 'feature', 'a.txt', 'feature content');
    const out = execFileSync(SCRIPT, ['main', 'feature'], {
      cwd: tmp, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dry-run-conflicts reports clean for branch ahead of main', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dryrun-test-'));
  try {
    setupRepo(tmp);
    createBranch(tmp, 'feature', 'feat.txt', 'feature work');
    const out = execFileSync(SCRIPT, ['main', 'feature'], {
      cwd: tmp, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dry-run-conflicts detects conflicts in diverged file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dryrun-test-'));
  try {
    setupRepo(tmp);
    createBranch(tmp, 'conflict-branch', 'shared.txt', 'feature content\n');
    git(['checkout', 'main'], tmp);
    writeFileSync(join(tmp, 'shared.txt'), 'main content\n');
    git(['add', '-A'], tmp);
    git(['commit', '-m', 'main changes shared'], tmp);
    let out = '';
    try {
      out = execFileSync(SCRIPT, ['main', 'conflict-branch'], {
        cwd: tmp, encoding: 'utf8', stdio: 'pipe',
      }).trim();
    } catch (e) {
      out = e.stdout ? e.stdout.trim() : '';
    }
    assert.match(out, /RESULT: conflicts/);
    assert.match(out, /shared\.txt/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dry-run-conflicts with HEAD defaults to current branch', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dryrun-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, ['main'], {
      cwd: tmp, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dry-run-conflicts without LMB auto-detects local main branch', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dryrun-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, [], {
      cwd: tmp, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
