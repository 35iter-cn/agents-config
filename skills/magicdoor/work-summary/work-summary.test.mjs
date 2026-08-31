import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CliError,
  parseArgs,
  resolveAuthor,
  discoverProjects,
  fetchCommits,
  filterSquashMerge,
} from './work-summary.mjs';

const SCRIPT = new URL('./work-summary.mjs', import.meta.url).pathname;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function setupRepo(base) {
  git(['init', '--initial-branch=main'], base);
  git(['config', 'user.email', 'test@test.com'], base);
  git(['config', 'user.name', 'Test'], base);
}

// ---------------------------------------------------------------------------
// parseArgs unit tests
// ---------------------------------------------------------------------------

test('parseArgs: required args only', () => {
  const result = parseArgs(['node', 'script', '--start-date', '2026-06-01', '--end-date', '2026-06-02']);
  assert.equal(result.startDate, '2026-06-01');
  assert.equal(result.endDate, '2026-06-02');
  assert.equal(result.author, null);
  assert.equal(result.prState, 'all');
});

test('parseArgs: with --author', () => {
  const result = parseArgs(['node', 'script', '--start-date', '2026-06-01', '--end-date', '2026-06-02', '--author', 'foo@bar.com']);
  assert.equal(result.author, 'foo@bar.com');
});

test('parseArgs: with --pr-state', () => {
  const result = parseArgs(['node', 'script', '--start-date', '2026-06-01', '--end-date', '2026-06-02', '--pr-state', 'merged']);
  assert.equal(result.prState, 'merged');
});

test('parseArgs: missing --start-date throws', () => {
  assert.throws(() => {
    parseArgs(['node', 'script', '--end-date', '2026-06-02']);
  }, CliError);
});

test('parseArgs: invalid --pr-state throws', () => {
  assert.throws(() => {
    parseArgs(['node', 'script', '--start-date', '2026-06-01', '--end-date', '2026-06-02', '--pr-state', 'invalid']);
  }, CliError);
});

test('parseArgs: invalid date format throws', () => {
  assert.throws(() => {
    parseArgs(['node', 'script', '--start-date', '06-01-2026', '--end-date', '2026-06-02']);
  }, CliError);
});

test('parseArgs: equals syntax', () => {
  const result = parseArgs(['node', 'script', '--start-date=2026-06-01', '--end-date=2026-06-02', '--author=foo@bar.com', '--pr-state=closed']);
  assert.equal(result.startDate, '2026-06-01');
  assert.equal(result.endDate, '2026-06-02');
  assert.equal(result.author, 'foo@bar.com');
  assert.equal(result.prState, 'closed');
});

// ---------------------------------------------------------------------------
// resolveAuthor tests
// ---------------------------------------------------------------------------

test('resolveAuthor: reads git config', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const result = resolveAuthor(tmp);
    assert.equal(result.email, 'test@test.com');
    assert.equal(result.name, 'Test');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAuthor: falls back to global git config outside repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    const result = resolveAuthor(tmp);
    // Global git config may or may not exist in the test environment.
    // We only assert the return type: either null or an object with email.
    if (result !== null) {
      assert.ok(typeof result.email === 'string');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// discoverProjects tests
// ---------------------------------------------------------------------------

test('discoverProjects: returns current repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    const result = discoverProjects(tmp);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, basename(tmp));
    assert.equal(result[0].dir, resolve(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('discoverProjects: scans one-level subdirectories', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    const repoA = join(tmp, 'repo-a');
    const plainB = join(tmp, 'plain-b');
    mkdirSync(repoA);
    mkdirSync(plainB);
    setupRepo(repoA);

    const result = discoverProjects(tmp);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'repo-a');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('discoverProjects: empty for non-repo with no sub-repos', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    const result = discoverProjects(tmp);
    assert.equal(result.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// fetchCommits integration tests
// ---------------------------------------------------------------------------

function makeCommit(cwd, file, msg, dateStr) {
  const env = { ...process.env, GIT_AUTHOR_DATE: `${dateStr}T12:00:00`, GIT_COMMITTER_DATE: `${dateStr}T12:00:00` };
  writeFileSync(join(cwd, file), `${file}\n`, { flag: 'a' });
  execFileSync('git', ['add', '-A'], { cwd, env });
  execFileSync('git', ['commit', '-m', msg], { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

test('fetchCommits: filters by author date and email', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    // Set up two authors
    git(['config', 'user.email', 'target@test.com'], tmp);
    makeCommit(tmp, 'a.txt', 'feat: add A', '2026-06-01');
    makeCommit(tmp, 'b.txt', 'feat: add B', '2026-06-02');
    git(['config', 'user.email', 'other@test.com'], tmp);
    makeCommit(tmp, 'c.txt', 'feat: add C', '2026-06-02');

    const commits = fetchCommits(tmp, 'target@test.com', '2026-06-01', '2026-06-02');
    assert.equal(commits.length, 2);
    assert.ok(commits.some(c => c.subject === 'feat: add A'));
    assert.ok(commits.some(c => c.subject === 'feat: add B'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('fetchCommits: case-insensitive email matching', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    git(['config', 'user.email', 'Target@Test.COM'], tmp);
    makeCommit(tmp, 'a.txt', 'feat: add A', '2026-06-01');

    const commits = fetchCommits(tmp, 'target@test.com', '2026-06-01', '2026-06-01');
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, 'feat: add A');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('fetchCommits: date range excludes out-of-range commits', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    git(['config', 'user.email', 'target@test.com'], tmp);
    makeCommit(tmp, 'a.txt', 'feat: add A', '2026-06-01');
    makeCommit(tmp, 'b.txt', 'feat: add B', '2026-06-03');

    const commits = fetchCommits(tmp, 'target@test.com', '2026-06-02', '2026-06-02');
    assert.equal(commits.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// filterSquashMerge unit tests
// ---------------------------------------------------------------------------

test('filterSquashMerge: removes squash merge when non-squash exists', () => {
  const commits = [
    { date: '2026-06-01', subject: 'feat: add X', hash: 'abc1234' },
    { date: '2026-06-01', subject: 'feat: add X (#42)', hash: 'def5678' },
    { date: '2026-06-01', subject: 'fix: bug Y', hash: 'ghi9012' },
  ];
  const result = filterSquashMerge(commits);
  assert.equal(result.length, 2);
  assert.ok(result.some(c => c.subject === 'feat: add X'));
  assert.ok(result.some(c => c.subject === 'fix: bug Y'));
  assert.ok(!result.some(c => c.subject === 'feat: add X (#42)'));
});

test('filterSquashMerge: keeps squash merge when no non-squash exists', () => {
  const commits = [
    { date: '2026-06-01', subject: 'feat: add X (#42)', hash: 'def5678' },
  ];
  const result = filterSquashMerge(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].subject, 'feat: add X (#42)');
});

test('filterSquashMerge: deduplicates by date+subject', () => {
  const commits = [
    { date: '2026-06-01', subject: 'feat: add X', hash: 'abc1234' },
    { date: '2026-06-01', subject: 'feat: add X', hash: 'def5678' },
  ];
  const result = filterSquashMerge(commits);
  assert.equal(result.length, 1);
});

test('filterSquashMerge: keeps issue-referencing commits when only unrelated bare commits exist', () => {
  // Regression (2026-08-31): the old logic marked ANY pr# as squash whenever
  // some unrelated bare commit existed in-window, wiping whole days where
  // every commit referenced the same issue (e.g. all '(#143)' receipts commits).
  const commits = [
    { date: '2026-08-05', subject: 'feat(a): generate receipt pdf (#143)', hash: 'h1' },
    { date: '2026-08-05', subject: 'chore(a): add transaction_receipts migration (#143)', hash: 'h2' },
    { date: '2026-08-06', subject: 'feat(b): rely on company scope (#143)', hash: 'h3' },
    { date: '2026-08-08', subject: 'chore(c): unrelated work', hash: 'h4' },
  ];
  const result = filterSquashMerge(commits);
  assert.equal(result.length, 4);
});

// ---------------------------------------------------------------------------
// End-to-end JSON output schema test
// ---------------------------------------------------------------------------

test('end-to-end: JSON schema is valid', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'summary-test-'));
  try {
    setupRepo(tmp);
    git(['config', 'user.email', 'target@test.com'], tmp);
    makeCommit(tmp, 'a.txt', 'feat: add A', '2026-06-01');

    const raw = execFileSync(SCRIPT, [
      '--start-date', '2026-06-01',
      '--end-date', '2026-06-01',
      '--author', 'target@test.com',
    ], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });

    const output = JSON.parse(raw);

    // Top-level keys
    assert.ok(output.meta, 'missing meta');
    assert.ok(output.dateRange, 'missing dateRange');
    assert.ok(output.author, 'missing author');
    assert.ok(Array.isArray(output.warnings), 'warnings must be array');
    assert.ok(Array.isArray(output.projects), 'projects must be array');

    // meta
    assert.ok(output.meta.generatedAt, 'missing generatedAt');
    assert.ok(output.meta.timezone, 'missing timezone');
    assert.ok(output.meta.prState, 'missing prState');

    // dateRange
    assert.ok(output.dateRange.start, 'missing dateRange.start');
    assert.ok(output.dateRange.end, 'missing dateRange.end');

    // author
    assert.ok(output.author.email, 'missing author.email');

    // project schema
    if (output.projects.length > 0) {
      const proj = output.projects[0];
      assert.ok(proj.name, 'missing project.name');
      assert.ok(proj.dir, 'missing project.dir');
      assert.ok(Array.isArray(proj.errors), 'project.errors must be array');
      assert.ok(Array.isArray(proj.commits), 'project.commits must be array');
      assert.ok(Array.isArray(proj.prs), 'project.prs must be array');

      if (proj.commits.length > 0) {
        const commit = proj.commits[0];
        assert.ok(commit.date, 'missing commit.date');
        assert.ok(commit.subject, 'missing commit.subject');
        assert.ok(commit.hash, 'missing commit.hash');
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
