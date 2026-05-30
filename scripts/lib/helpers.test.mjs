import test from 'node:test';
import assert from 'node:assert/strict';
import { expandTilde, trimSpace, targetUnderSrc, readLines, warn, error } from './helpers.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('expandTilde replaces ~ with homedir', () => {
  const home = process.env.HOME || '/root';
  assert.equal(expandTilde('~'), home);
  assert.equal(expandTilde('~/foo'), `${home}/foo`);
  assert.equal(expandTilde('~/a/b/c'), `${home}/a/b/c`);
});

test('expandTilde returns unchanged for non-tilde paths', () => {
  assert.equal(expandTilde('/absolute/path'), '/absolute/path');
  assert.equal(expandTilde('relative/path'), 'relative/path');
  assert.equal(expandTilde('~notilde'), '~notilde');
});

test('trimSpace trims whitespace', () => {
  assert.equal(trimSpace('  hello  '), 'hello');
  assert.equal(trimSpace('\thello\n'), 'hello');
  assert.equal(trimSpace(''), '');
  assert.equal(trimSpace('  '), '');
});

test('targetUnderSrc returns true for exact match', () => {
  assert.equal(targetUnderSrc('/root/skills', '/root/skills'), true);
});

test('targetUnderSrc returns true for nested path', () => {
  assert.equal(targetUnderSrc('/root/skills/companions/runx', '/root/skills'), true);
});

test('targetUnderSrc returns false for path outside root', () => {
  assert.equal(targetUnderSrc('/other/skills', '/root/skills'), false);
});

test('targetUnderSrc returns false for empty target', () => {
  assert.equal(targetUnderSrc('', '/root/skills'), false);
  assert.equal(targetUnderSrc(null, '/root/skills'), false);
  assert.equal(targetUnderSrc(undefined, '/root/skills'), false);
});

test('readLines reads file, skips comments and blanks, expands tilde', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helpers-test-'));
  try {
    const home = process.env.HOME || '/root';
    writeFileSync(join(dir, 'test.txt'), [
      '# this is a comment',
      '',
      '  ~/target/path  ',
      '',
      '  # indented comment',
      '/absolute/path',
    ].join('\n'), 'utf8');

    const lines = readLines(join(dir, 'test.txt'));
    assert.equal(lines.length, 2);
    assert.equal(lines[0], `${home}/target/path`);
    assert.equal(lines[1], '/absolute/path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLines with skipComments=false includes comment lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helpers-test-'));
  try {
    writeFileSync(join(dir, 'test.txt'), '# comment\n\nvalue\n', 'utf8');
    const lines = readLines(join(dir, 'test.txt'), { skipComments: false });
    assert.equal(lines.length, 2);
    assert.equal(lines[0], '# comment');
    assert.equal(lines[1], 'value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
