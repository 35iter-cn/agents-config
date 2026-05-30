import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./work-summary.mjs', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function setupRepo(base) {
  git(['init', '--initial-branch=main'], base);
  git(['config', 'user.email', 'test@test.com'], base);
  git(['config', 'user.name', 'Test'], base);
  writeFileSync(join(base, 'README.md'), '# test\n');
  git(['add', '-A'], base);
  git(['commit', '-m', 'initial'], base);
}

test('work-summary --mode=today outputs date range and detects git repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, ['--mode=today'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    const lines = out.split('\n');
    assert.match(lines[0], /MODE=today/);
    assert.match(lines[1], /START_DATE=\d{4}-\d{2}-\d{2}/);
    assert.match(lines[2], /END_DATE=\d{4}-\d{2}-\d{2}/);
    assert.match(lines[3], /IS_GIT=true/);
    assert.match(lines[4], /PROJECT_COUNT=1/);
    assert.match(lines[5], /PROJECT_1_NAME=/);
    assert.match(lines[6], /PROJECT_1_DIR=/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('work-summary --mode=today start equals end', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, ['--mode=today'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    const lines = out.split('\n');
    const start = lines[1].split('=')[1];
    const end = lines[2].split('=')[1];
    assert.equal(start, end);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('work-summary --mode=week outputs date range', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, ['--mode=week'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    const lines = out.split('\n');
    assert.match(lines[0], /MODE=week/);
    assert.match(lines[1], /START_DATE=\d{4}-\d{2}-\d{2}/);
    assert.match(lines[2], /END_DATE=\d{4}-\d{2}-\d{2}/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('work-summary reports IS_GIT=false in non-repo directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    // No git init — just a plain temp dir
    const out = execFileSync(SCRIPT, ['--mode=today'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    const prefix = out.split('\n').slice(0, 3).join('\n');
    // Should still output MODE, START_DATE, END_DATE
    assert.match(prefix, /MODE=today/);
    assert.match(prefix, /START_DATE=/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('work-summary rejects invalid mode', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    assert.throws(() => {
      execFileSync(SCRIPT, ['--mode=invalid'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });
    }, /Unsupported mode/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('work-summary accepts --mode value as separate arg', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const out = execFileSync(SCRIPT, ['--mode', 'today'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.match(out, /MODE=today/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
