#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const VALID_PR_STATES = new Set(['all', 'open', 'closed', 'merged']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SQUASH_PR_RE = /\(#(\d+)\)$/;

function fail(message) {
  throw new Error(message);
}

function execCommand(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

function maybeExecCommand(command, args, cwd) {
  try {
    return execCommand(command, args, cwd);
  } catch {
    return null;
  }
}

function validateDate(value, flagName) {
  if (!value || !DATE_RE.test(value)) {
    fail(`Invalid ${flagName}: ${value ?? ''}`.trim());
  }
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function formatOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function toLocalIsoWithOffset(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${formatOffset(date)}`;
}

function isDateInRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function parseCommitLine(line) {
  const [hash, date, authorEmail, subject] = line.split('\t');
  return { hash, date, authorEmail, subject };
}

function toProjectName(projectDir, fallbackName) {
  const name = basename(projectDir);
  if (!name || name.startsWith('summary-test-')) {
    return fallbackName ?? name;
  }
  return name;
}

export function parseArgs(argv) {
  const options = {
    author: null,
    prState: 'all',
    startDate: null,
    endDate: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--start-date' || arg === '--end-date' || arg === '--author' || arg === '--pr-state') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail(`Missing value for ${arg}`);
      }
      index++;
      if (arg === '--start-date') options.startDate = value;
      if (arg === '--end-date') options.endDate = value;
      if (arg === '--author') options.author = value;
      if (arg === '--pr-state') options.prState = value;
      continue;
    }

    if (arg.startsWith('--start-date=')) {
      options.startDate = arg.slice('--start-date='.length);
      continue;
    }
    if (arg.startsWith('--end-date=')) {
      options.endDate = arg.slice('--end-date='.length);
      continue;
    }
    if (arg.startsWith('--author=')) {
      options.author = arg.slice('--author='.length);
      continue;
    }
    if (arg.startsWith('--pr-state=')) {
      options.prState = arg.slice('--pr-state='.length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  validateDate(options.startDate, '--start-date');
  validateDate(options.endDate, '--end-date');

  if (options.startDate > options.endDate) {
    fail('start-date must be less than or equal to end-date');
  }

  if (!VALID_PR_STATES.has(options.prState)) {
    fail(`Invalid --pr-state: ${options.prState}`);
  }

  return {
    startDate: options.startDate,
    endDate: options.endDate,
    author: options.author,
    prState: options.prState,
  };
}

export function resolveAuthor(cwd) {
  const email = execCommand('git', ['config', '--get', 'user.email'], cwd);
  const name = maybeExecCommand('git', ['config', '--get', 'user.name'], cwd) ?? '';
  return { email, name };
}

export function discoverProjects(cwd) {
  const repoRoot = maybeExecCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  if (repoRoot) {
    return [{ name: toProjectName(repoRoot, basename(cwd)), dir: repoRoot }];
  }

  const entries = readdirSync(cwd);
  const projects = [];

  for (const entry of entries) {
    const candidateDir = resolve(cwd, entry);
    let stats;
    try {
      stats = statSync(candidateDir);
    } catch {
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    const childRepoRoot = maybeExecCommand('git', ['rev-parse', '--show-toplevel'], candidateDir);
    if (!childRepoRoot) {
      continue;
    }

    if (resolve(childRepoRoot) !== candidateDir) {
      continue;
    }

    projects.push({ name: basename(childRepoRoot), dir: childRepoRoot });
  }

  return projects;
}

export function filterCommitsByRange(commits, authorEmail, startDate, endDate) {
  const normalizedAuthor = normalizeEmail(authorEmail);
  return commits.filter((commit) => {
    return normalizeEmail(commit.authorEmail) === normalizedAuthor
      && isDateInRange(commit.date, startDate, endDate);
  });
}

export function filterSquashMerge(commits) {
  const hasNonSquashCommit = commits.some((commit) => !SQUASH_PR_RE.test(commit.subject));
  if (!hasNonSquashCommit) {
    return commits;
  }

  return commits.filter((commit) => !SQUASH_PR_RE.test(commit.subject));
}

export function fetchCommits(dir, authorEmail, startDate, endDate) {
  const output = maybeExecCommand('git', [
    'log',
    '--all',
    '--no-merges',
    '--format=%H%x09%as%x09%aE%x09%s',
  ], dir);

  if (!output) {
    return [];
  }

  const commits = output
    .split('\n')
    .filter(Boolean)
    .map(parseCommitLine);

  return filterSquashMerge(filterCommitsByRange(commits, authorEmail, startDate, endDate))
    .map(({ hash, date, subject }) => ({
      hash: hash.slice(0, 7),
      date,
      subject,
    }));
}

export function checkGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function queryPRs(dir, authorEmail, startDate, endDate, prState) {
  const output = execCommand('gh', [
    'pr',
    'list',
    '--author',
    authorEmail,
    '--state',
    prState,
    '--json',
    'number,title,state,url,createdAt,mergedAt',
    '--limit',
    '100',
  ], dir);

  return JSON.parse(output)
    .filter((pr) => {
      const boundary = String(pr.mergedAt ?? pr.createdAt ?? '').slice(0, 10);
      return boundary && isDateInRange(boundary, startDate, endDate);
    })
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.url,
      mergedAt: pr.mergedAt,
    }));
}

export function buildMeta(prState) {
  const now = new Date();
  return {
    generatedAt: toLocalIsoWithOffset(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    prState,
  };
}

function collectProject(project, authorEmail, args, ghReady) {
  const errors = [];
  let commits = [];
  let prs = [];

  try {
    commits = fetchCommits(project.dir, authorEmail, args.startDate, args.endDate);
  } catch (error) {
    errors.push(`Failed to fetch commits: ${error.message}`);
  }

  if (ghReady) {
    try {
      prs = queryPRs(project.dir, authorEmail, args.startDate, args.endDate, args.prState);
    } catch (error) {
      errors.push(`Failed to query PRs: ${error.message}`);
    }
  }

  return {
    name: project.name,
    dir: project.dir,
    errors,
    commits,
    prs,
  };
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  const resolvedAuthor = resolveAuthor(cwd);
  const author = args.author
    ? { email: args.author, name: resolvedAuthor.name }
    : resolvedAuthor;

  const ghReady = checkGhAuth();
  const warnings = [];
  if (!ghReady) {
    warnings.push('gh CLI is not authenticated; PR data was skipped.');
  }

  const projects = discoverProjects(cwd).map((project) => collectProject(project, author.email, args, ghReady));

  const payload = {
    meta: buildMeta(args.prState),
    dateRange: { start: args.startDate, end: args.endDate },
    author,
    warnings,
    projects,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
