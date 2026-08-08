#!/usr/bin/env node
// Sync executable files from canonical cli/ into configured targets as flat symlinks.
// Source basename === PATH command name.
import { readdirSync, lstatSync, symlinkSync, mkdirSync, existsSync, realpathSync, unlinkSync, readlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLines, targetUnderSrc, warn, error } from './lib/helpers.mjs';

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_ROOT, '..');
const DEFAULT_ROOT = resolve(REPO_ROOT, 'cli');
const DEFAULT_TARGETS = resolve(REPO_ROOT, 'scripts/cli-symlinks.targets');

let CLI_ROOT = resolve(process.env.CLI_CANONICAL_ROOT || DEFAULT_ROOT);
let TARGETS_FILE = process.env.CLI_SYMLINKS_TARGETS || DEFAULT_TARGETS;
let MODE = 'link';
let DRY_RUN = false;
let PRUNE = true;

function usage() {
  console.log(`Usage: sync-cli [link|unlink] [options]

Commands:
  link    Create/update symlinks and prune stale managed links (default)
  unlink  Remove symlinks under target dirs that point into the canonical tree

Options:
  -s, --source PATH     Canonical cli root (default: <repo>/cli)
  --no-prune            With link: do not remove stale managed symlinks
  --dry-run             Print actions only
  -h, --help            Show this help

Env: CLI_CANONICAL_ROOT, CLI_SYMLINKS_TARGETS`);
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
      CLI_ROOT = resolve(args[++i]);
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

function scanCli(root) {
  const nameToPath = new Map();
  const orderedNames = [];

  let entries;
  try { entries = readdirSync(root); } catch {
    error(`canonical root does not exist: ${root}`);
  }

  for (const base of entries) {
    if (base.startsWith('.')) continue;
    const path = resolve(root, base);
    let st;
    try { st = lstatSync(path); } catch { continue; }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    if (st.isSymbolicLink()) {
      let targetStat;
      try { targetStat = lstatSync(realpathSync(path)); } catch { continue; }
      if (!targetStat.isFile()) continue;
    }

    if (nameToPath.has(base)) {
      process.stderr.write(`error: duplicate cli link name '${base}'\n`);
      process.exit(3);
    }
    nameToPath.set(base, path);
    orderedNames.push(base);
  }

  orderedNames.sort();
  return { nameToPath, orderedNames };
}

function doLink() {
  if (!existsSync(TARGETS_FILE)) {
    error(`targets file not found: ${TARGETS_FILE}`, 5);
  }

  const { nameToPath, orderedNames } = scanCli(CLI_ROOT);
  const targets = readLines(TARGETS_FILE);

  for (const rawDst of targets) {
    if (!rawDst) continue;
    const absDst = resolve(rawDst);
    mkdirSync(absDst, { recursive: true });

    for (const name of orderedNames) {
      const target = nameToPath.get(name);
      const linkPath = resolve(absDst, name);

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
      try {
        linkTarget = realpathSync(entryPath);
      } catch {
        let raw;
        try { raw = readlinkSync(entryPath); } catch { continue; }
        linkTarget = resolve(dirname(entryPath), raw);
        if (!(targetUnderSrc(linkTarget, CLI_ROOT) && !currentNames.has(entry))) {
          warn(`broken symlink, not pruning: ${entryPath}`);
          continue;
        }
      }

      if (targetUnderSrc(linkTarget, CLI_ROOT) && !currentNames.has(entry)) {
        if (DRY_RUN) {
          console.log(`dry-run: rm -f ${JSON.stringify(entryPath)}`);
        } else {
          unlinkSync(entryPath);
        }
      }
    }
  }
}

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

      if (targetUnderSrc(linkTarget, CLI_ROOT)) {
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
