#!/usr/bin/env node
// Sync leaf skill dirs from canonical tree into configured targets as flat symlinks.
import { readdirSync, lstatSync, symlinkSync, mkdirSync, existsSync, realpathSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandTilde, readLines, targetUnderSrc, warn, error } from './lib/helpers.mjs';

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_ROOT, '..');
const DEFAULT_ROOT = resolve(REPO_ROOT, 'skills');
const DEFAULT_TARGETS = resolve(REPO_ROOT, 'scripts/skills-symlinks.targets');

let SKILLS_ROOT = resolve(process.env.SKILLS_CANONICAL_ROOT || DEFAULT_ROOT);
let TARGETS_FILE = process.env.SKILLS_SYMLINKS_TARGETS || DEFAULT_TARGETS;
let MODE = 'link';
let DRY_RUN = false;
let PRUNE = true;

function usage() {
  console.log(`Usage: sync-skills [link|unlink] [options]

Commands:
  link    Create/update symlinks and prune stale managed links (default)
  unlink  Remove symlinks under target dirs that point into the canonical tree

Options:
  -s, --source PATH     Canonical skills root (default: <repo>/skills)
  --no-prune            With link: do not remove stale managed symlinks
  --dry-run             Print actions only
  -h, --help            Show this help

Env: SKILLS_CANONICAL_ROOT, SKILLS_SYMLINKS_TARGETS`);
}

const args = process.argv.slice(2);
if (args[0] === 'link' || args[0] === 'unlink') {
  MODE = args.shift();
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '-s':
    case '--source':
      SKILLS_ROOT = resolve(args[++i]);
      break;
    case '--no-prune':
      PRUNE = false;
      break;
    case '--dry-run':
      DRY_RUN = true;
      break;
    case '-h':
    case '--help':
      usage();
      process.exit(0);
    default:
      error(`Unknown option: ${arg}`, 2);
  }
}

// --- Scan canonical root ---
function scanSkills(root) {
  const nameToPath = new Map();
  const orderedNames = [];

  function registerLink(name, targetPath) {
    if (nameToPath.has(name)) {
      process.stderr.write(`error: duplicate skill link name '${name}'\n`);
      process.stderr.write(`  - ${nameToPath.get(name)}\n`);
      process.stderr.write(`  - ${targetPath}\n`);
      process.exit(3);
    }
    nameToPath.set(name, targetPath);
    orderedNames.push(name);
  }

  let entries;
  try { entries = readdirSync(root); } catch {
    error(`canonical root does not exist: ${root}`);
  }

  for (const base of entries) {
    const top = resolve(root, base);
    let st;
    try { st = lstatSync(top); } catch { continue; }
    if (!st) continue;

    // Flat skill: directory containing SKILL.md at top level
    if (st.isDirectory()) {
      if (existsSync(resolve(top, 'SKILL.md'))) {
        registerLink(base, top);
        continue;
      }
    }

    if (st.isDirectory()) {
      const prefixFile = resolve(top, '.symlink-prefix');
      let prefix = '';
      if (existsSync(prefixFile)) {
        prefix = readFileSync(prefixFile, 'utf8').trim() + '_';
      }
      let children;
      try { children = readdirSync(top); } catch { continue; }
      for (const child of children) {
        const childPath = resolve(top, child);
        let childSt;
        try { childSt = lstatSync(childPath); } catch { continue; }
        if (!childSt.isDirectory()) continue;
        if (existsSync(resolve(childPath, 'SKILL.md'))) {
          registerLink(prefix + child, childPath);
        }
      }
    }
  }

  return { nameToPath, orderedNames };
}

// --- Link mode ---
function doLink() {
  if (!existsSync(TARGETS_FILE)) {
    error(`targets file not found: ${TARGETS_FILE}`, 5);
  }

  const { nameToPath, orderedNames } = scanSkills(SKILLS_ROOT);
  const targets = readLines(TARGETS_FILE);

  for (const rawDst of targets) {
    if (!rawDst) continue;
    const absDst = resolve(rawDst);
    mkdirSync(absDst, { recursive: true });

    for (const name of orderedNames) {
      const target = nameToPath.get(name);
      const linkPath = resolve(absDst, name);

      // Check existing entry — only refuse if it's a real file/dir, not a symlink
      if (existsSync(linkPath) || lstatSync(linkPath, { throwIfNoEntry: false })) {
        if (!lstatSync(linkPath).isSymbolicLink()) {
          error(`'${linkPath}' exists and is not a symlink (refusing to replace)`, 4);
        }
      }

      if (DRY_RUN) {
        console.log(`dry-run: ln -sfn ${JSON.stringify(target)} ${JSON.stringify(linkPath)}`);
      } else {
        try { unlinkSync(linkPath); } catch { /* not exist, ok */ }
        symlinkSync(target, linkPath);
      }
    }

    if (!PRUNE) continue;
    const currentNames = new Set(orderedNames);
    let targetEntries;
    try { targetEntries = readdirSync(absDst); } catch { continue; }

    for (const entry of targetEntries) {
      const entryPath = resolve(absDst, entry);
      let entryStat;
      try { entryStat = lstatSync(entryPath); } catch { continue; }
      if (!entryStat.isSymbolicLink()) continue;

      let linkTarget;
      try { linkTarget = realpathSync(entryPath); } catch {
        warn(`broken symlink, not pruning: ${entryPath}`);
        continue;
      }

      if (targetUnderSrc(linkTarget, SKILLS_ROOT) && !currentNames.has(entry)) {
        if (DRY_RUN) {
          console.log(`dry-run: rm -f ${JSON.stringify(entryPath)}`);
        } else {
          unlinkSync(entryPath);
        }
      }
    }
  }
}

// --- Unlink mode ---
function doUnlink() {
  if (!existsSync(TARGETS_FILE)) {
    error(`targets file not found: ${TARGETS_FILE}`, 5);
  }

  const targets = readLines(TARGETS_FILE);
  for (const rawDst of targets) {
    if (!rawDst) continue;
    const absDst = resolve(rawDst);
    if (!existsSync(absDst)) continue;

    let entries;
    try { entries = readdirSync(absDst); } catch { continue; }

    for (const entry of entries) {
      const entryPath = resolve(absDst, entry);
      let entryStat;
      try { entryStat = lstatSync(entryPath); } catch { continue; }
      if (!entryStat) continue;

      if (!entryStat.isSymbolicLink()) {
        if (entryStat.isFile() || entryStat.isDirectory()) {
          warn(`not a symlink, skipping: ${entryPath}`);
        }
        continue;
      }

      let linkTarget;
      try { linkTarget = realpathSync(entryPath); } catch {
        warn(`broken symlink, not removing: ${entryPath}`);
        continue;
      }

      if (targetUnderSrc(linkTarget, SKILLS_ROOT)) {
        if (DRY_RUN) {
          console.log(`dry-run: rm -f ${JSON.stringify(entryPath)}`);
        } else {
          unlinkSync(entryPath);
        }
      }
    }
  }
}

if (MODE === 'link') doLink();
else if (MODE === 'unlink') doUnlink();
else error(`internal: bad mode ${MODE}`, 2);
