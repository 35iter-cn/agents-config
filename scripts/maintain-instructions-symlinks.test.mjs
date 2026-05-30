import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./maintain-instructions-symlinks.mjs', import.meta.url).pathname;

function run(args = [], opts = {}) {
  return execFileSync(SCRIPT, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...opts,
  }).trim();
}

test('dry-run link prints mkdir and ln commands', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maintain-test-'));
  try {
    const instructionsDir = join(tmp, 'instructions');
    mkdirSync(instructionsDir, { recursive: true });
    writeFileSync(join(instructionsDir, 'default.md'), '# test\n');
    const manifest = join(tmp, 'paths.txt');
    const dstDir = join(tmp, 'out');
    writeFileSync(manifest, `${dstDir}/CLAUDE.md\n`, 'utf8');

    const out = run(['link', '--dry-run', '-r', tmp, '-c', 'default'], {
      env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: manifest },
    });

    assert.match(out, /dry-run: mkdir -p.*out/);
    assert.match(out, /dry-run: ln -sf.*default\.md.*CLAUDE\.md/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('link creates actual symlink', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maintain-test-'));
  try {
    const instructionsDir = join(tmp, 'instructions');
    mkdirSync(instructionsDir, { recursive: true });
    const canonPath = join(instructionsDir, 'default.md');
    writeFileSync(canonPath, '# test\n');
    const manifest = join(tmp, 'paths.txt');
    const dstDir = join(tmp, 'out');
    const linkPath = join(dstDir, 'CLAUDE.md');
    writeFileSync(manifest, `${linkPath}\n`, 'utf8');

    run(['link', '-r', tmp, '-c', 'default'], {
      env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: manifest },
    });

    assert.equal(readlinkSync(linkPath), canonPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('dry-run unlink prints rm commands for managed symlinks', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maintain-test-'));
  try {
    const instructionsDir = join(tmp, 'instructions');
    mkdirSync(instructionsDir, { recursive: true });
    const canonPath = join(instructionsDir, 'default.md');
    writeFileSync(canonPath, '# test\n');
    const manifest = join(tmp, 'paths.txt');
    const dstDir = join(tmp, 'out');
    const linkPath = join(dstDir, 'CLAUDE.md');
    writeFileSync(manifest, `${linkPath}\n`, 'utf8');

    // First link
    run(['link', '-r', tmp, '-c', 'default'], {
      env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: manifest },
    });

    // Dry-run unlink
    const out = run(['unlink', '--dry-run', '-r', tmp, '-c', 'default'], {
      env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: manifest },
    });

    assert.match(out, /dry-run: rm -f.*CLAUDE\.md/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('error for invalid stem', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maintain-test-'));
  try {
    assert.throws(() => {
      run(['-c', 'with/slash'], { env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: join(tmp, 'nonexistent') } });
    }, /must not contain/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('error for missing canonical file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maintain-test-'));
  try {
    const manifest = join(tmp, 'paths.txt');
    writeFileSync(manifest, '/tmp/dummy\n', 'utf8');
    assert.throws(() => {
      run(['link', '-r', tmp], {
        env: { ...process.env, INSTRUCTIONS_SYMLINKS_MANIFEST: manifest },
      });
    }, /canonical instruction file missing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
