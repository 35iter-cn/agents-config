#!/usr/bin/env node
// Simulate a rebase of FEATURE_BRANCH onto LMB in an isolated worktree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function git(args, opts = {}) {
  const result = execFileSync('git', args, {
    encoding: 'utf8',
    stdio: opts.silent ? 'pipe' : 'inherit',
    ...opts,
  });
  return result ? result.trim() : '';
}

function gitCapture(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function gitLines(args, opts = {}) {
  const out = execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  return out ? out.split('\n') : [];
}

function error(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

// --- Resolve args ---
const LMB_ARG = process.argv[2] || '';
const FEATURE_BRANCH = process.argv[3] || 'HEAD';

// --- Fetch ---
// Fetch if remote exists — not fatal if none
console.log('=== Fetching remote ===');
try { git(['fetch', 'origin', '--prune']); } catch {
  console.log('(no remote origin, skipping fetch)');
}
// --- Resolve LMB ---
let LMB = LMB_ARG;

// Validate: if user passed a local branch name, prefer the remote tracking branch
if (LMB && !LMB.startsWith('origin/')) {
  const remoteRef = `origin/${LMB}`;
  try {
    gitCapture(['rev-parse', '--verify', remoteRef]);
    console.log(`WARNING: '${LMB}' is a local branch. LMB must be a remote branch. Using '${remoteRef}' instead.`);
    LMB = remoteRef;
  } catch {
    console.log(`WARNING: '${LMB}' does not appear to be a remote branch. LMB should be a remote ref (e.g., origin/main).`);
  }
}

if (!LMB) {
  error('LMB argument is required. Usage: node dry-run-conflicts.mjs <lmb> [feature-branch]');
}

const HEAD_SHA = gitCapture(['rev-parse', FEATURE_BRANCH]);
const BRANCH_NAME = gitCapture(['rev-parse', '--abbrev-ref', FEATURE_BRANCH]);
const LMB_SHA = gitCapture(['rev-parse', LMB]);
const MERGE_BASE = gitCapture(['merge-base', LMB_SHA, HEAD_SHA]);
const DIVERGED = gitLines(['log', '--oneline', `${MERGE_BASE}..${HEAD_SHA}`]).length;

const safeName = BRANCH_NAME.replace(/\//g, '-');
const WORKTREE = mkdtempSync(join(tmpdir(), `dry-run-${safeName}-`));

let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  try {
    git(['worktree', 'remove', WORKTREE, '--force'], { silent: true });
  } catch {
    rmSync(WORKTREE, { recursive: true, force: true });
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

console.log('=== Dry-run Config ===');
console.log(`LMB (latest main):  ${LMB} -> ${LMB_SHA}`);
console.log(`Feature branch:     ${BRANCH_NAME} -> ${HEAD_SHA}`);
console.log(`Merge base:         ${MERGE_BASE.slice(0, 7)}`);
console.log(`Diverged commits:   ${DIVERGED}`);
console.log(`Worktree:           ${WORKTREE}`);
console.log('');

// Create worktree at LMB commit (detached HEAD)
console.log('=== Creating isolated worktree ===');
const wtOutput = gitCapture(['worktree', 'add', '--detach', WORKTREE, LMB_SHA]);
console.log(wtOutput);
console.log('');

// Simulate rebase: apply diverged commits onto LMB
try {
  execFileSync('git', ['rebase', '--onto', 'HEAD', MERGE_BASE, HEAD_SHA], {
    cwd: WORKTREE,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  console.log('RESULT: clean');
  console.log('No conflicts detected. Safe to rebase directly.');
  try { git(['-C', WORKTREE, 'rebase', '--abort'], { silent: true }); } catch { /* ok */ }
  process.exit(0);
} catch {
  // Conflicts exist — collect details
  let conflictFiles = gitLines(['diff', '--name-only', '--diff-filter=U'], { cwd: WORKTREE });
  if (conflictFiles.length === 0 || (conflictFiles.length === 1 && !conflictFiles[0])) {
    // Some rebase conflicts are in the index but not in working tree
    try {
      const porc = gitCapture(['status', '--porcelain'], { cwd: WORKTREE });
      conflictFiles = porc.split('\n')
        .filter(l => /^(DD|AU|UD|UA|DU|AA|UU)/.test(l.trim()))
        .map(l => l.trim().split(/\s+/).pop())
        .filter(Boolean);
    } catch { /* fallback */ }
  }
  conflictFiles = [...new Set(conflictFiles.filter(Boolean))];
  const conflictCount = conflictFiles.length;

  console.log('RESULT: conflicts');
  console.log(`Conflicts: ${conflictCount} files`);
  console.log('');

  for (const f of conflictFiles) {
    console.log(`--- ${f} ---`);
    try {
      const content = execFileSync('git', ['grep', '-n', '-B2', '-A2', '<<<<<<<', '--', f], {
        cwd: WORKTREE,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      console.log(content || '  (no conflict lines shown)');
    } catch {
      console.log('  (binary/staged-only conflict - see: git diff on this file)');
    }
    console.log('');
  }

  try { git(['-C', WORKTREE, 'rebase', '--abort'], { silent: true }); } catch { /* ok */ }
  process.exit(1);
}
