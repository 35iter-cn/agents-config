import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildMeta,
  filterCommitsByRange,
  filterSquashMerge,
  parseArgs,
} from './work-summary.mjs';

const SCRIPT = new URL('./work-summary.mjs', import.meta.url).pathname;

function git(args, cwd, env = process.env) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

function runScript(args, options = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function setupRepo(base, { email = 'test@test.com', name = 'Test User' } = {}) {
  git(['init', '--initial-branch=main'], base);
  git(['config', 'user.email', email], base);
  git(['config', 'user.name', name], base);
  writeFileSync(join(base, 'README.md'), '# test\n');
  git(['add', '-A'], base);
  git(['commit', '-m', 'initial'], base, {
    ...process.env,
    GIT_AUTHOR_DATE: '2026-05-01T12:00:00',
    GIT_COMMITTER_DATE: '2026-05-01T12:00:00',
  });
}

function commitFile(repoDir, filename, contents, message, date, authorEmail = 'test@test.com') {
  writeFileSync(join(repoDir, filename), contents);
  git(['add', filename], repoDir);
  git(['commit', '-m', message], repoDir, {
    ...process.env,
    GIT_AUTHOR_DATE: `${date}T12:00:00`,
    GIT_COMMITTER_DATE: `${date}T12:00:00`,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_EMAIL: authorEmail,
  });
}

function makeGhShim(dir, mode = 'auth-fail') {
  const shim = join(dir, 'gh');
  const script = mode === 'auth-fail'
    ? `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 1
fi
exit 0
`
    : `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%s\n' '[{"number":42,"title":"Collector PR","state":"MERGED","url":"https://example.com/pr/42","createdAt":"2026-06-01T09:00:00Z","mergedAt":"2026-06-03T10:00:00Z"}]'
  exit 0
fi
exit 1
`;

  writeFileSync(shim, script);
  chmodSync(shim, 0o755);
}

test('parseArgs reads required dates and optional flags', () => {
  const actual = parseArgs([
    '--start-date', '2026-06-01',
    '--end-date', '2026-06-05',
    '--author', 'user@example.com',
    '--pr-state', 'merged',
  ]);

  assert.deepEqual(actual, {
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    author: 'user@example.com',
    prState: 'merged',
  });
});

test('buildMeta uses local timezone information', () => {
  const actual = buildMeta('all');
  assert.equal(actual.prState, 'all');
  assert.equal(actual.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.match(actual.generatedAt, /T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('filterCommitsByRange keeps author-date matches in local date strings', () => {
  const commits = [
    { date: '2026-06-01', authorEmail: 'user@example.com', subject: 'keep', hash: '1111111' },
    { date: '2026-06-06', authorEmail: 'user@example.com', subject: 'drop', hash: '2222222' },
    { date: '2026-06-03', authorEmail: 'other@example.com', subject: 'drop-other', hash: '3333333' },
  ];

  const actual = filterCommitsByRange(commits, 'USER@example.com', '2026-06-01', '2026-06-05');
  assert.deepEqual(actual.map((commit) => commit.subject), ['keep']);
});

test('filterSquashMerge removes redundant squash commits that reference PR numbers', () => {
  const actual = filterSquashMerge([
    { date: '2026-06-02', subject: 'feat: add collector plumbing', hash: '1111111' },
    { date: '2026-06-02', subject: 'feat: add collector plumbing (#42)', hash: '2222222' },
  ]);

  assert.deepEqual(actual.map((commit) => commit.hash), ['1111111']);
});

test('CLI emits JSON for a temp git repo and skips PRs when gh auth fails', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  const binDir = join(tmp, 'bin');
  mkdirSync(binDir);

  try {
    setupRepo(tmp);
    commitFile(tmp, 'feature.txt', 'alpha\n', 'feat: add collector plumbing', '2026-06-02');
    commitFile(tmp, 'feature.txt', 'beta\n', 'feat: add collector plumbing (#42)', '2026-06-03');
    commitFile(tmp, 'ignored.txt', 'gamma\n', 'feat: ignored other author', '2026-06-02', 'other@example.com');

    makeGhShim(binDir, 'auth-fail');

    const output = runScript([
      '--start-date', '2026-06-01',
      '--end-date', '2026-06-05',
    ], {
      cwd: tmp,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });

    const actual = JSON.parse(output);

    assert.equal(actual.dateRange.start, '2026-06-01');
    assert.equal(actual.dateRange.end, '2026-06-05');
    assert.equal(actual.author.email, 'test@test.com');
    assert.equal(actual.projects.length, 1);
    assert.equal(actual.projects[0].name, basename(tmp));
    assert.deepEqual(actual.projects[0].commits.map((commit) => commit.subject), ['feat: add collector plumbing']);
    assert.deepEqual(actual.projects[0].prs, []);
    assert.match(actual.warnings[0], /gh CLI is not authenticated/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI honors author and pr-state with gh shim', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  const binDir = join(tmp, 'bin');
  mkdirSync(binDir);

  try {
    setupRepo(tmp, { email: 'default@example.com', name: 'Default User' });
    commitFile(tmp, 'feature.txt', 'alpha\n', 'feat: included override author', '2026-06-02', 'override@example.com');

    makeGhShim(binDir, 'success');

    const output = runScript([
      '--start-date', '2026-06-01',
      '--end-date', '2026-06-05',
      '--author', 'override@example.com',
      '--pr-state', 'merged',
    ], {
      cwd: tmp,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });

    const actual = JSON.parse(output);
    assert.equal(actual.author.email, 'override@example.com');
    assert.equal(actual.meta.prState, 'merged');
    assert.equal(actual.projects[0].prs[0].number, 42);
    assert.equal(actual.projects[0].prs[0].state, 'MERGED');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
