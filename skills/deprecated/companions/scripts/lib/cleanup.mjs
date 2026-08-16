import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_OPTIONS = {
  dir: '/tmp/companions',
  pattern: /^\d{4}-\d{2}-\d{2}-\d{2}:\d{2}-[a-f0-9]+\.jsonl$/,
  maxAgeDays: 3,
  maxCount: 20,
};

export const _internals = { unlink };

export async function cleanupAgentshubLogs(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const cutoff = now - opts.maxAgeDays * 24 * 60 * 60 * 1000;

  try {
    await stat(opts.dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { deleted: [], kept: [], errors: [] };
    }
    throw err;
  }

  const entries = await readdir(opts.dir);

  const files = [];
  for (const entry of entries) {
    if (!opts.pattern.test(entry)) continue;

    const fullPath = join(opts.dir, entry);
    let stats;
    try {
      stats = await stat(fullPath);
    } catch (err) {
      files.push({ name: entry, path: fullPath, mtime: null, error: err.message });
      continue;
    }

    if (!stats.isFile()) continue;

    files.push({ name: entry, path: fullPath, mtime: stats.mtime.getTime() });
  }

  files.sort((a, b) => b.mtime - a.mtime);

  const toDelete = [];
  const kept = [];
  const errors = [];

  let keptCount = 0;
  for (const file of files) {
    if (file.error) {
      errors.push({ file: file.name, error: file.error });
      continue;
    }

    if (file.mtime < cutoff || keptCount >= opts.maxCount) {
      toDelete.push(file);
    } else {
      kept.push(file.name);
      keptCount++;
    }
  }

  const deleted = [];
  await Promise.all(
    toDelete.map(async (file) => {
      try {
        await _internals.unlink(file.path);
        deleted.push(file.name);
      } catch (err) {
        errors.push({ file: file.name, error: err.message });
      }
    }),
  );

  return { deleted, kept, errors };
}
