import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./verify-no-conflicts.mjs', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function setupRepo(base) {
  git(['init', '--initial-branch=main'], base);
  git(['config', 'user.email', 'test@test.com'], base);
  git(['config', 'user.name', 'Test'], base);
  writeFileSync(join(base, 'README.md'), '# clean\n');
  git(['add', '-A'], base);
  git(['commit', '-m', 'initial'], base);
}

test('verify reports clean for repo with no conflict markers', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, [], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /RESULT: clean/);
    assert.match(out, /No conflict markers found\./);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify reports conflicts when conflict markers exist', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  try {
    setupRepo(tmp);
    writeFileSync(join(tmp, 'conflict.txt'), '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n');
    git(['add', '-A'], tmp);
    git(['commit', '-m', 'add conflicts'], tmp);

    let out = '';
    try {
      out = execFileSync(SCRIPT, [], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
      out = e.stdout ? e.stdout.trim() : '';
    }
    assert.match(out, /RESULT: conflicts/);
    assert.match(out, /conflict\.txt/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify excludes lockfiles from conflict scan', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  try {
    setupRepo(tmp);
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), '<<<<<<< HEAD\npackage: a\n=======\npackage: b\n>>>>>>> branch\n');
    writeFileSync(join(tmp, 'clean.txt'), 'no conflict\n');
    git(['add', '-A'], tmp);
    git(['commit', '-m', 'add lockfile with markers'], tmp);

    const out = execFileSync(SCRIPT, [], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify excludes binary file types from conflict scan', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  try {
    setupRepo(tmp);
    writeFileSync(join(tmp, 'icon.svg'), '<<<<<<< HEAD\n<svg/>\n=======\n<svg2/>\n>>>>>>> branch\n');
    git(['add', '-A'], tmp);
    git(['commit', '-m', 'add svg with markers'], tmp);

    const out = execFileSync(SCRIPT, [], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /RESULT: clean/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
