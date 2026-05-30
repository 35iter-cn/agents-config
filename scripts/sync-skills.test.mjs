import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('./sync-skills.mjs', import.meta.url).pathname;

function createSkillsDir(base, structure) {
  mkdirSync(base, { recursive: true });
  for (const [name, value] of Object.entries(structure)) {
    if (value === true) {
      const dir = join(base, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n`);
    } else {
      const catDir = join(base, name);
      mkdirSync(catDir, { recursive: true });
      if (value.prefix) {
        writeFileSync(join(catDir, '.symlink-prefix'), value.prefix + '\n');
      }
      for (const skill of value.skills) {
        const skillDir = join(catDir, skill);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, 'SKILL.md'), `# ${skill}\n`);
      }
    }
  }
}

function run(source, targetsFile, extraArgs = []) {
  return execFileSync(SCRIPT, ['link', '--dry-run', '-s', source, ...extraArgs], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, SKILLS_SYMLINKS_TARGETS: targetsFile },
  }).trim();
}

test('sync-skills dry-run lists flat skills', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  try {
    createSkillsDir(tmp, { 'alpha': true, 'beta': true });
    const targetsFile = join(tmp, 'targets.txt');
    const dst = join(tmp, 'dst');
    writeFileSync(targetsFile, `${dst}\n`, 'utf8');
    const out = run(tmp, targetsFile);
    assert.match(out, /alpha.*dst\/alpha/);
    assert.match(out, /beta.*dst\/beta/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sync-skills dry-run prefixes category skills', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  try {
    createSkillsDir(tmp, { 'companions': { prefix: 'companions', skills: ['runx', 'tune'] } });
    const targetsFile = join(tmp, 'targets.txt');
    const dst = join(tmp, 'dst');
    writeFileSync(targetsFile, `${dst}\n`, 'utf8');
    const out = run(tmp, targetsFile);
    assert.match(out, /companions_runx/);
    assert.match(out, /companions_tune/);
    assert.doesNotMatch(out, /dst\/runx\b/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sync-skills dry-run categories without prefix use bare names', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  try {
    createSkillsDir(tmp, { 'productivity': { prefix: '', skills: ['grill'] } });
    const targetsFile = join(tmp, 'targets.txt');
    const dst = join(tmp, 'dst');
    writeFileSync(targetsFile, `${dst}\n`, 'utf8');
    const out = run(tmp, targetsFile);
    assert.match(out, /dst\/grill/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sync-skills creates actual symlinks', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  try {
    createSkillsDir(tmp, { 'myskill': true });
    const targetsFile = join(tmp, 'targets.txt');
    const dst = join(tmp, 'dst');
    mkdirSync(dst);
    writeFileSync(targetsFile, `${dst}\n`, 'utf8');
    execFileSync(SCRIPT, ['link', '-s', tmp], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, SKILLS_SYMLINKS_TARGETS: targetsFile },
    });
    assert.ok(existsSync(join(dst, 'myskill')));
    const linkTarget = readlinkSync(join(dst, 'myskill'));
    assert.ok(linkTarget.endsWith('/myskill'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sync-skills unlink removes managed symlinks', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  try {
    createSkillsDir(tmp, { 'myskill': true });
    const targetsFile = join(tmp, 'targets.txt');
    const dst = join(tmp, 'dst');
    mkdirSync(dst);
    writeFileSync(targetsFile, `${dst}\n`, 'utf8');
    execFileSync(SCRIPT, ['link', '-s', tmp], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, SKILLS_SYMLINKS_TARGETS: targetsFile },
    });
    assert.ok(existsSync(join(dst, 'myskill')));
    const out = execFileSync(SCRIPT, ['unlink', '--dry-run', '-s', tmp], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, SKILLS_SYMLINKS_TARGETS: targetsFile },
    }).trim();
    assert.match(out, /dry-run: rm -f/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
