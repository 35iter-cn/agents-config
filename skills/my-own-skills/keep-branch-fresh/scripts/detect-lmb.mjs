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

try {
  const output = gitCapture(['ls-remote', '--symref', remote, 'HEAD']);
  const match = output.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m);
  if (!match) {
    error(`Could not determine HEAD ref for remote '${remote}'.`);
  }
  const branch = match[1];
  process.stdout.write(`${remote}/${branch}\n`);
} catch {
  const candidates = [`${remote}/main`, `${remote}/master`];
  for (const ref of candidates) {
    try {
      gitCapture(['rev-parse', '--verify', ref]);
      process.stdout.write(`${ref}\n`);
      process.exit(0);
    } catch { /* try next */ }
  }
  error(`Could not determine default branch for remote '${remote}'. Tried ${candidates.join(', ')}.`);
}
