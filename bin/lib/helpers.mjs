import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function expandTilde(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

export function trimSpace(s) {
  return s.trim();
}

export function targetUnderSrc(target, absRoot) {
  if (!target) return false;
  return target === absRoot || target.startsWith(absRoot + '/');
}

export function resolveRepoRoot(metaUrl) {
  const scriptPath = fileURLToPath(metaUrl);
  return resolve(dirname(scriptPath), '..');
}

export function readLines(filePath, { skipComments = true, expandTilde: doExpand = true } = {}) {
  const content = readFileSync(filePath, 'utf8');
  const lines = [];
  for (const raw of content.split('\n')) {
    const line = trimSpace(raw);
    if (!line) continue;
    if (skipComments && line.startsWith('#')) continue;
    lines.push(doExpand ? expandTilde(line) : line);
  }
  return lines;
}

export function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

export function error(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}
