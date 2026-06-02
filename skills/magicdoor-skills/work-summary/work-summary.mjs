#!/usr/bin/env node
// End-to-end work summary data collector.
// Outputs JSON with commits and PRs grouped by project.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// ---------------------------------------------------------------------------
// 1. Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    startDate: null,
    endDate: null,
    author: null,
    prState: 'all',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--start-date') {
      result.startDate = args[++i];
    } else if (arg.startsWith('--start-date=')) {
      result.startDate = arg.slice(13);
    } else if (arg === '--end-date') {
      result.endDate = args[++i];
    } else if (arg.startsWith('--end-date=')) {
      result.endDate = arg.slice(11);
    } else if (arg === '--author') {
      result.author = args[++i];
    } else if (arg.startsWith('--author=')) {
      result.author = arg.slice(9);
    } else if (arg === '--pr-state') {
      result.prState = args[++i];
    } else if (arg.startsWith('--pr-state=')) {
      result.prState = arg.slice(11);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      printUsage();
      process.exit(1);
    }
  }

  if (!result.startDate || !result.endDate) {
    process.stderr.write('Error: --start-date and --end-date are required\n');
    printUsage();
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(result.endDate)) {
    process.stderr.write('Error: dates must be in YYYY-MM-DD format\n');
    printUsage();
    process.exit(1);
  }

  const validStates = ['all', 'open', 'merged', 'closed'];
  if (!validStates.includes(result.prState)) {
    process.stderr.write(`Error: --pr-state must be one of: ${validStates.join(', ')}\n`);
    printUsage();
    process.exit(1);
  }

  return result;
}

function printUsage() {
  process.stderr.write(`Usage: node work-summary.mjs --start-date YYYY-MM-DD --end-date YYYY-MM-DD [--author email] [--pr-state all|open|merged|closed]
`);
}

// ---------------------------------------------------------------------------
// 2. Resolve author from git config
// ---------------------------------------------------------------------------
function resolveAuthor(cwd) {
  try {
    const email = execFileSync('git', ['config', '--get', 'user.email'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    let name = '';
    try {
      name = execFileSync('git', ['config', '--get', 'user.name'], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    } catch {
      // name is optional
    }
    return { email, name };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Discover projects
// ---------------------------------------------------------------------------
function discoverProjects(cwd) {
  // Case 1: cwd itself is a git repo
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (repoRoot) {
      return [{ name: basename(repoRoot), dir: resolve(repoRoot) }];
    }
  } catch {
    // Not a git repo, fall through to subdirectory scan
  }

  // Case 2: scan immediate subdirectories
  let entries;
  try {
    entries = readdirSync(cwd);
  } catch {
    return [];
  }

  const projects = [];
  for (const entry of entries) {
    const candidatePath = resolve(cwd, entry);
    let st;
    try {
      st = statSync(candidatePath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let repoRoot;
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: candidatePath,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    } catch {
      continue;
    }

    if (!repoRoot) continue;
    const realCandidate = resolve(candidatePath);
    if (realCandidate !== resolve(repoRoot)) continue;

    projects.push({ name: basename(repoRoot), dir: realCandidate });
  }

  return projects;
}

// ---------------------------------------------------------------------------
// 4. Fetch commits
// ---------------------------------------------------------------------------
function fetchCommits(dir, authorEmail, startDate, endDate) {
  const output = execFileSync(
    'git',
    ['log', '--all', '--no-merges', '--format=%as\t%aE\t%s\t%h'],
    { cwd: dir, encoding: 'utf8', stdio: 'pipe' }
  );

  const lines = output.trim().split('\n').filter(Boolean);
  const commits = [];
  const authorLower = authorEmail.toLowerCase();

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [dateStr, emailStr, subject, hash] = parts;
    if (dateStr < startDate || dateStr > endDate) continue;
    if (emailStr.toLowerCase() !== authorLower) continue;
    commits.push({ date: dateStr, subject, hash });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// 5. Filter squash-merge commits
// ---------------------------------------------------------------------------
function filterSquashMerge(commits) {
  const seenKeys = new Set();
  const result = [];

  // First pass: build a set of PR numbers that appear in any commit subject
  const prNumbersInRange = new Set();
  for (const c of commits) {
    const match = c.subject.match(/#(\d+)/);
    if (match) prNumbersInRange.add(match[1]);
  }

  // Second pass: determine which commits are squash merges
  const squashPrs = new Set();
  for (const prNum of prNumbersInRange) {
    let hasNonSquash = false;
    for (const c of commits) {
      const match = c.subject.match(/#(\d+)/);
      if (!match || match[1] !== prNum) {
        // This commit does NOT reference this PR number → non-squash exists
        hasNonSquash = true;
        break;
      }
    }
    if (hasNonSquash) {
      squashPrs.add(prNum);
    }
  }

  // Third pass: filter out squash merges and deduplicate
  for (const c of commits) {
    const match = c.subject.match(/#(\d+)/);
    if (match && squashPrs.has(match[1])) {
      continue; // exclude squash-merge commit
    }
    const key = `${c.date}\t${c.subject}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push(c);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 6. Check gh auth
// ---------------------------------------------------------------------------
function checkGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 7. Query PRs
// ---------------------------------------------------------------------------
function queryPRs(dir, authorEmail, startDate, endDate, prState) {
  if (!checkGhAuth()) return [];

  const stateArg = prState === 'all' ? 'all' : prState;
  const args = [
    'pr', 'list',
    '--state', stateArg,
    '--json', 'number,title,state,url,createdAt,mergedAt',
    '--limit', '100',
  ];

  // Try to filter by author; gh --author accepts GitHub username.
  // If the email looks like a GitHub username (no @), use --author.
  // Otherwise we filter client-side.
  const isUsername = !authorEmail.includes('@');
  if (isUsername) {
    args.push('--author', authorEmail);
  }

  let raw;
  try {
    raw = execFileSync('gh', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return [];
  }

  let prs;
  try {
    prs = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(prs)) return [];

  const result = [];
  for (const pr of prs) {
    // Client-side author filtering when we couldn't use --author
    if (!isUsername) {
      // We can't reliably match email from gh pr list output.
      // Skip client-side email filtering; rely on --search when possible.
      // For now, include all PRs from the repo and let the AI handle filtering.
    }

    const dateField = pr.mergedAt || pr.createdAt;
    if (!dateField) continue;
    const dateStr = dateField.slice(0, 10); // YYYY-MM-DD
    if (dateStr < startDate || dateStr > endDate) continue;

    result.push({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.url,
      mergedAt: pr.mergedAt || null,
      createdAt: pr.createdAt || null,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 8. Main
// ---------------------------------------------------------------------------
function main() {
  const { startDate, endDate, author, prState } = parseArgs(process.argv);

  const cwd = process.cwd();
  const authorInfo = author
    ? { email: author, name: '' }
    : resolveAuthor(cwd);

  if (!authorInfo || !authorInfo.email) {
    process.stderr.write('Error: could not determine author email. Use --author.\n');
    process.exit(1);
  }

  const projects = discoverProjects(cwd);
  const warnings = [];
  const ghAvailable = checkGhAuth();
  if (!ghAvailable) {
    warnings.push('gh CLI not authenticated; PR section skipped');
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ||
    `UTC${new Date().getTimezoneOffset() <= 0 ? '+' : '-'}${String(Math.abs(new Date().getTimezoneOffset() / 60)).padStart(2, '0')}:${String(Math.abs(new Date().getTimezoneOffset() % 60)).padStart(2, '0')}`;

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      timezone: tz,
      prState,
    },
    dateRange: { start: startDate, end: endDate },
    author: { email: authorInfo.email, name: authorInfo.name || '' },
    warnings,
    projects: [],
  };

  for (const project of projects) {
    const projectOut = {
      name: project.name,
      dir: project.dir,
      errors: [],
      commits: [],
      prs: [],
    };

    try {
      const rawCommits = fetchCommits(project.dir, authorInfo.email, startDate, endDate);
      projectOut.commits = filterSquashMerge(rawCommits);
    } catch (err) {
      projectOut.errors.push(`fetchCommits failed: ${err.message}`);
    }

    try {
      projectOut.prs = queryPRs(project.dir, authorInfo.email, startDate, endDate, prState);
    } catch (err) {
      projectOut.errors.push(`queryPRs failed: ${err.message}`);
    }

    output.projects.push(projectOut);
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
