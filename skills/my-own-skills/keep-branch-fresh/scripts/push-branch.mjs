#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

function gitCapture(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function gitTry(args, opts = {}) {
  try { return gitCapture(args, opts); } catch { return ''; }
}

function error(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

// --- Resolve branch and remote ---
let BRANCH, REMOTE;
try {
  BRANCH = gitCapture(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch {
  error('Not in a git repository.');
}

const remotes = gitTry(['remote']).split('\n').filter(Boolean);
if (remotes.length === 0) {
  error('No remote configured.');
}
REMOTE = remotes.includes('origin') ? 'origin' : remotes[0];
if (REMOTE !== 'origin') {
  console.log(`WARNING: No origin remote, using ${REMOTE}`);
}

// --- Detect upstream ---
let hasUpstream = false;
try {
  gitCapture(['rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`]);
  hasUpstream = true;
} catch {
  hasUpstream = false;
}

console.log(`=== Push ===`);
console.log(`Branch: ${BRANCH}`);
console.log(`Remote: ${REMOTE}`);

// --- Push ---
try {
  if (hasUpstream) {
    console.log('Strategy: force-with-lease');
    gitCapture(['push', '--force-with-lease', REMOTE, BRANCH]);
  } else {
    console.log('Strategy: set-upstream');
    gitCapture(['push', '--set-upstream', REMOTE, BRANCH]);
  }
  console.log('RESULT: pushed');
  process.exit(0);
} catch (e) {
  const stderr = e.stderr ? e.stderr.toString() : '';
  if (stderr.includes('rejected') || stderr.includes('stale info') || stderr.includes('non-fast-forward')) {
    console.log('RESULT: failed');
    console.log('Reason: 远程分支有新提交，本地落后。建议重新执行 dry-run。');
    process.exit(2);
  }
  console.log('RESULT: failed');
  console.log(`Reason: ${stderr || e.message || 'Unknown error'}`);
  process.exit(1);
}
