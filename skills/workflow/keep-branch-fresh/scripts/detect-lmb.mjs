#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

function gitCapture(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function error(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

const REMOTE_ARG = process.argv[2] || 'auto';
let remote;

if (REMOTE_ARG !== 'auto') {
  remote = REMOTE_ARG;
} else {
  const remotes = gitCapture(['remote']).split('\n').filter(Boolean);
  if (remotes.length === 0) {
    error('No git remotes configured. Cannot determine LMB.');
  }
  if (remotes.length > 1) {
    error(`Multiple remotes found: ${remotes.join(', ')}. Specify one: node detect-lmb.mjs <remote>`);
  }
  remote = remotes[0];
}

try {
  gitCapture(['fetch', remote, '--prune']);
} catch {
  process.stderr.write(`WARNING: fetch from '${remote}' failed, using cached refs.\n`);
}

let match = null;
try {
  const output = gitCapture(['ls-remote', '--symref', remote, 'HEAD']);
  match = output.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m);
} catch {
  // ls-remote failed — fall through to fallback
}

if (match) {
  process.stdout.write(`${remote}/${match[1]}\n`);
} else {
  const candidates = [`${remote}/main`, `${remote}/master`];
  let found = false;
  for (const ref of candidates) {
    try {
      gitCapture(['rev-parse', '--verify', ref]);
      process.stdout.write(`${ref}\n`);
      found = true;
      break;
    } catch { /* try next */ }
  }
  if (!found) {
    error(`Could not determine default branch for remote '${remote}'. Tried ${candidates.join(', ')}.`);
  }
}
