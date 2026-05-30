#!/usr/bin/env node
// Verify that no conflict markers remain and the rebase is in a good state.
import { execFileSync } from 'node:child_process';

function gitCapture(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function gitTry(args) {
  try { return gitCapture(args); } catch { return ''; }
}

console.log('=== Checking for remaining conflict markers ===');

// Search for conflict markers in tracked files (excluding lockfiles and binary files)
const excludePatterns = [
  '*.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  '*.svg', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico',
  '*.woff', '*.woff2', '*.ttf', '*.eot',
];

const excludeArgs = excludePatterns.flatMap(p => [':!', p]);
const files = gitTry(['grep', '-l', '<<<<<<<', '--', '.', ...excludeArgs]);

if (!files) {
  console.log('RESULT: clean');
  console.log('No conflict markers found.');

  // Check if we're in the middle of a rebase
  const rebaseMerge = gitTry(['rev-parse', '--git-path', 'rebase-merge']);
  const rebaseApply = gitTry(['rev-parse', '--git-path', 'rebase-apply']);

  if ((rebaseMerge && gitTry(['test', '-d', rebaseMerge])) ||
      (rebaseApply && gitTry(['test', '-d', rebaseApply]))) {
    console.log('');
    console.log('WARNING: Rebase still in progress. Run: git rebase --continue');
    console.log('To abort: git rebase --abort');
    process.exit(1);
  }

  process.exit(0);
}

const conflictFiles = files.split('\n').filter(Boolean);
console.log(`RESULT: conflicts`);
console.log(`Found conflict markers in ${conflictFiles.length} file(s):`);
console.log(conflictFiles.join('\n'));
console.log('');
console.log('Locations:');

for (const f of conflictFiles) {
  console.log(`--- ${f} ---`);
  try {
    const lines = gitCapture(['grep', '-n', '<<<<<<<\\|=======\\>>>>>>>', '--', f]);
    console.log(lines);
  } catch {
    // file may have been resolved
  }
  console.log('');
}

process.exit(1);
