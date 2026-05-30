#!/usr/bin/env node
// Generate work summary from git commits and related PRs.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';

let MODE = 'today';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--mode') {
    MODE = args[++i];
  } else if (arg.startsWith('--mode=')) {
    MODE = arg.slice(7);
  } else {
    process.stderr.write(`Unknown argument: ${arg}\n`);
    process.exit(1);
  }
}

if (MODE !== 'today' && MODE !== 'week') {
  process.stderr.write(`Unsupported mode: ${MODE}\n`);
  process.exit(1);
}

// Compute date range (no Python dependency)
const now = new Date();
const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
let startDate, endDate;

if (MODE === 'today') {
  startDate = today;
  endDate = today;
} else {
  // week: Saturday to Friday
  const dayOfWeek = today.getUTCDay(); // 0=Sun, 6=Sat
  const daysSinceSaturday = (dayOfWeek + 1) % 7;
  startDate = new Date(today);
  startDate.setUTCDate(today.getUTCDate() - daysSinceSaturday);
  endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

const START_DATE = fmtDate(startDate);
const END_DATE = fmtDate(endDate);

console.log(`MODE=${MODE}`);
console.log(`START_DATE=${START_DATE}`);
console.log(`END_DATE=${END_DATE}`);

// Detect git repo
let currentRepo;
try {
  currentRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim();
} catch {
  currentRepo = '';
}

if (currentRepo) {
  console.log('IS_GIT=true');
  console.log('PROJECT_COUNT=1');
  console.log(`PROJECT_1_NAME=${basename(currentRepo)}`);
  console.log(`PROJECT_1_DIR=${currentRepo}`);
  process.exit(0);
}

// No git repo at cwd — scan subdirectories for git repos
const cwd = process.cwd();
let entries;
try { entries = readdirSync(cwd); } catch {
  console.log('IS_GIT=false');
  console.log('PROJECT_COUNT=0');
  process.exit(0);
}

let projectCount = 0;
const projects = [];

for (const entry of entries) {
  const candidatePath = resolve(cwd, entry);
  let st;
  try { st = statSync(candidatePath); } catch { continue; }
  if (!st.isDirectory()) continue;

  let repoRoot;
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: candidatePath,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch { continue; }

  if (!repoRoot) continue;

  const realCandidate = resolve(candidatePath);
  if (realCandidate !== repoRoot) continue;

  projectCount++;
  projects.push({ name: basename(repoRoot), dir: repoRoot });
}

console.log('IS_GIT=false');
console.log(`PROJECT_COUNT=${projectCount}`);
for (let i = 0; i < projects.length; i++) {
  console.log(`PROJECT_${i + 1}_NAME=${projects[i].name}`);
  console.log(`PROJECT_${i + 1}_DIR=${projects[i].dir}`);
}
