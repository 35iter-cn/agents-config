#!/usr/bin/env node
// Maintain symlinks from manifest to $REPO/instructions/<stem>.md (link / unlink).
import { symlinkSync, mkdirSync, existsSync, realpathSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandTilde, readLines, warn, error } from './lib/helpers.mjs';

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_ROOT, '..');
const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'scripts/instructions-symlinks.paths');

let MODE = 'link';
let REPO = REPO_ROOT;
let STEM = 'default';
let DRY_RUN = false;
let MANIFEST = process.env.INSTRUCTIONS_SYMLINKS_MANIFEST || DEFAULT_MANIFEST;

function usage() {
  console.log(`Usage: maintain-instructions-symlinks [link|unlink] [options]
Commands:
  link    Create/update symlinks (default)
  unlink  Remove symlinks that resolve into this repo
Options:
  -r, --repo PATH       Repo root (default: parent of scripts/ containing this script)
  -c, --canonical STEM  Instruction stem without .md (default: default)
  --dry-run             Print actions only
  -h, --help            Show this help
Env:
  INSTRUCTIONS_SYMLINKS_MANIFEST  Path to manifest (default: <repo>/scripts/instructions-symlinks.paths)`);
}

const args = process.argv.slice(2);
if (args[0] === 'link' || args[0] === 'unlink') {
  MODE = args.shift();
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '-r':
    case '--repo':
      REPO = resolve(args[++i]);
      break;
    case '-c':
    case '--canonical':
      STEM = args[++i];
      break;
    case '--dry-run':
      DRY_RUN = true;
      break;
    case '-h':
    case '--help':
      usage();
      process.exit(0);
    default:
      error(`unknown option or argument: ${arg}`);
  }
}

if (!STEM) error('canonical stem must be non-empty');
if (STEM.includes('/')) error(`invalid canonical stem (must not contain '/'): ${STEM}`);
if (STEM.startsWith('.')) error(`invalid canonical stem (must not start with '.'): ${STEM}`);

const REPO_ABS = resolve(REPO);
const CANON = resolve(REPO_ABS, 'instructions', STEM + '.md');

function doLink() {
  if (!existsSync(CANON)) error(`canonical instruction file missing: ${CANON}`);

  const targets = readLines(MANIFEST);
  for (const rawL of targets) {
    if (!rawL) continue;
    const L = resolve(rawL);
    const parent = dirname(L);

    if (DRY_RUN) {
      console.log(`dry-run: mkdir -p ${JSON.stringify(parent)}`);
      console.log(`dry-run: ln -sf ${JSON.stringify(CANON)} ${JSON.stringify(L)}`);
    } else {
      mkdirSync(parent, { recursive: true });
      try { unlinkSync(L); } catch { /* not exist, ok */ }
      symlinkSync(CANON, L);
    }
  }
}

function doUnlink() {
  const targets = readLines(MANIFEST);
  for (const rawL of targets) {
    if (!rawL) continue;
    const L = resolve(rawL);

    if (!existsSync(L)) continue;
    const entryStat = lstatSync(L);

    if (!entryStat.isSymbolicLink()) {
      if (entryStat.isFile() || entryStat.isDirectory()) {
        warn(`not a symlink, skipping: ${L}`);
      }
      continue;
    }

    let linkTarget;
    try { linkTarget = realpathSync(L); } catch {
      warn(`broken symlink, not removing: ${L}`);
      continue;
    }

    if (linkTarget === REPO_ABS || linkTarget.startsWith(REPO_ABS + '/')) {
      if (DRY_RUN) {
        console.log(`dry-run: rm -f ${JSON.stringify(L)}`);
      } else {
        unlinkSync(L);
      }
    }
  }
}

if (MODE === 'link') doLink();
else if (MODE === 'unlink') doUnlink();
else error(`internal: bad mode ${MODE}`);
