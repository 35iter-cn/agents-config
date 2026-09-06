#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { ADJECTIVES } from './words/adjectives.mjs';
import { NOUNS } from './words/nouns.mjs';

const COMMANDS = ['init', 'resolve', 'artifact-create', 'plan-status', 'verify', 'worktree-path', 'worktree-check', 'guard', 'find', 'pr-add'];
const PLAN_STATUSES = ['open', 'implemented'];
const ARTIFACT_TYPES = ['spec', 'plan', 'research', 'handoff', 'uat-case', 'notes'];
const NON_SPEC_ARTIFACT_TYPES = ['research', 'handoff', 'uat-case', 'notes'];

function sessionsRoot() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'sessions');
}

function topicDir(topic) {
  return join(sessionsRoot(), topic);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resolveRepo(dir = process.cwd()) {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return basename(toplevel).replace(/^worktree-/, '');
  } catch {
    return basename(dir).replace(/^worktree-/, '');
  }
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateSuffix() {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

function normalizeSemantic(hint) {
  const words = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 3);
  if (words.length === 0) throw new Error('semantic hint cannot be empty');
  return words.join('-');
}

function validateTopicName(name) {
  const pattern = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+){0,2}-[a-z]+-[a-z]+$/;
  if (!pattern.test(name)) throw new Error(`invalid topic name: ${name}`);
}

function stateFileError(topic, content) {
  const preview = JSON.stringify(content.slice(0, 80).replace(/\n/g, '\\n'));
  return new Error(`STATE.md frontmatter 缺失或损坏: ${topic}/STATE.md 前80字符: ${preview}`);
}

function parseState(content, topic = '') {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    throw stateFileError(topic, content);
  }

  const endIndex = lines.indexOf('---', 1);
  if (endIndex === -1) {
    throw stateFileError(topic, content);
  }

  const frontmatter = lines.slice(1, endIndex).join('\n');
  const body = lines.slice(endIndex + 1).join('\n').replace(/^\n+/, '');

  const state = { topic: '', title: '', created: today(), current_spec: '', specs: [], artifacts: [], prs: [] };
  let currentSpec = null;
  let currentArtifact = null;
  let currentPr = null;
  let inSpecs = false;
  let inArtifacts = false;
  let inPrs = false;

  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed === 'specs:') {
      inSpecs = true;
      inArtifacts = false;
      currentSpec = null;
      currentArtifact = null;
      continue;
    }

    if (trimmed === 'artifacts:') {
      inArtifacts = true;
      inSpecs = false;
      currentSpec = null;
      currentArtifact = null;
      continue;
    }

    if (trimmed === 'prs:') {
      inPrs = true;
      inSpecs = false;
      inArtifacts = false;
      currentSpec = null;
      currentArtifact = null;
      currentPr = null;
      continue;
    }

    if (inSpecs) {
      const listMatch = trimmed.match(/^- id:\s*(.+)$/);
      if (listMatch) {
        currentSpec = { id: listMatch[1].trim(), name: '', plan: null };
        state.specs.push(currentSpec);
        continue;
      }

      if (currentSpec) {
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          const key = trimmed.slice(0, colonIndex).trim();
          const value = trimmed.slice(colonIndex + 1).trim();
          if (key === 'name') currentSpec[key] = value;
          if (key === 'plan') currentSpec.plan = value === 'true' ? 'implemented' : value;
        }
        continue;
      }

      inSpecs = false;
    }

    if (inArtifacts) {
      const listMatch = trimmed.match(/^- id:\s*(.+)$/);
      if (listMatch) {
        currentArtifact = { id: listMatch[1].trim(), name: '', type: '', file: '' };
        state.artifacts.push(currentArtifact);
        continue;
      }

      if (currentArtifact) {
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          const key = trimmed.slice(0, colonIndex).trim();
          const value = trimmed.slice(colonIndex + 1).trim();
          if (['name', 'type', 'file'].includes(key)) currentArtifact[key] = value;
        }
        continue;
      }

      inArtifacts = false;
    }

    if (inPrs) {
      const listMatch = trimmed.match(/^- repo:\s*(.+)$/);
      if (listMatch) {
        currentPr = { repo: listMatch[1].trim(), number: '', branch: null };
        state.prs.push(currentPr);
        continue;
      }

      if (currentPr) {
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          const key = trimmed.slice(0, colonIndex).trim();
          const value = trimmed.slice(colonIndex + 1).trim();
          if (key === 'number') currentPr.number = value;
          if (key === 'branch' && value) currentPr.branch = value;
        }
        continue;
      }

      inPrs = false;
    }

    currentSpec = null;
    currentArtifact = null;
    currentPr = null;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (['topic', 'title', 'created', 'current_spec'].includes(key)) {
      state[key] = value;
    }
  }

  if (!state.topic || !state.title) {
    throw stateFileError(topic, content);
  }

  return { ...state, body };
}

function formatSpec(spec) {
  let lines = `  - id: ${spec.id}\n    name: ${spec.name}`;
  if (spec.plan) {
    lines += `\n    plan: ${spec.plan}`;
  }
  return lines;
}

function formatArtifact(artifact) {
  return [
    `  - id: ${artifact.id}`,
    `    name: ${artifact.name}`,
    `    type: ${artifact.type}`,
    `    file: ${artifact.file}`,
  ].join('\n');
}

function formatPr(pr) {
  let lines = `  - repo: ${pr.repo}\n    number: ${pr.number}`;
  if (pr.branch) lines += `\n    branch: ${pr.branch}`;
  return lines;
}

function formatState(state) {
  const lines = [
    '---',
    `topic: ${state.topic}`,
    `title: ${state.title}`,
    `created: ${state.created}`,
    `current_spec: ${state.current_spec}`,
    'specs:',
    ...state.specs.map(formatSpec),
    'artifacts:',
    ...state.artifacts.map(formatArtifact),
  ];
  if (state.prs && state.prs.length > 0) {
    lines.push('prs:', ...state.prs.map(formatPr));
  }
  lines.push('---', '', state.body);
  return lines.join('\n');
}

function readState(topic) {
  const path = join(topicDir(topic), 'STATE.md');
  if (!existsSync(path)) {
    return { topic, title: '', created: today(), current_spec: '', specs: [], artifacts: [], prs: [], body: '' };
  }
  return parseState(readFileSync(path, 'utf-8'), topic);
}

function writeState(topic, state) {
  const dir = topicDir(topic);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'STATE.md'), formatState(state));
}

function parseArtifactNumber(filename) {
  const match = filename.match(/^(\d{2,})-/);
  return match ? parseInt(match[1], 10) : 0;
}

function nextArtifactNumber(topic) {
  const state = readState(topic);
  const numbers = [
    ...state.specs.map((s) => parseInt(s.id, 10)),
    ...state.artifacts.map((a) => parseInt(a.id, 10)),
  ];
  const dir = topicDir(topic);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const n = parseArtifactNumber(file);
      if (n > 0) numbers.push(n);
    }
  }
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return String(max + 1).padStart(2, '0');
}

function specName(topic, id) {
  const state = readState(topic);
  const fromState = state.specs.find((s) => s.id === id);
  if (fromState) return fromState.name;

  const pattern = new RegExp(`^${id}-(.+)\\.spec\\.md$`);
  const dir = topicDir(topic);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const match = file.match(pattern);
      if (match) return match[1];
    }
  }
  throw new Error(`spec ${id} not found in topic ${topic}`);
}

function titleFromSemantic(semantic) {
  return semantic
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function init(args) {
  if (args.length < 1) throw new Error('usage: session-topic init <semantic-hint>');
  const semantic = normalizeSemantic(args[0]);
  const topic = `${today()}-${semantic}-${generateSuffix()}`;
  const dir = topicDir(topic);
  if (existsSync(dir)) throw new Error(`topic already exists: ${topic}`);

  mkdirSync(dir, { recursive: true });
  writeState(topic, {
    topic,
    title: titleFromSemantic(semantic),
    created: today(),
    current_spec: '',
    specs: [],
    artifacts: [],
    body: '',
  });

  console.log(topic);
}

function resolveTopic(args) {
  if (args.length < 1) throw new Error('usage: session-topic resolve <topic>');
  const topic = args[0];
  validateTopicName(topic);
  console.log(topicDir(topic));
}

function createSpec(topic, name) {
  const id = nextArtifactNumber(topic);
  const dir = topicDir(topic);
  const filename = `${id}-${name}.spec.md`;
  const file = join(dir, filename);

  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) throw new Error(`spec file already exists: ${file}; 如需重建请先手动删除`);
  writeFileSync(file, '');

  const state = readState(topic);
  state.specs.push({ id, name, plan: null });
  state.current_spec = id;
  writeState(topic, state);

  return file;
}

function createPlan(topic, id) {
  const name = specName(topic, id);
  const dir = topicDir(topic);
  const filename = `${id}-${name}.plan.md`;
  const file = join(dir, filename);

  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '');

  const state = readState(topic);
  const spec = state.specs.find((s) => s.id === id);
  if (!spec) throw new Error(`spec ${id} not found; create the spec before creating its plan`);
  spec.plan = 'open';
  writeState(topic, state);

  return file;
}

function createOtherArtifact(topic, type, name) {
  const id = nextArtifactNumber(topic);
  const dir = topicDir(topic);
  const filename = `${id}-${name}.${type}.md`;
  const file = join(dir, filename);

  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) throw new Error(`artifact file already exists: ${file}; 如需重建请先手动删除`);
  writeFileSync(file, '');

  const state = readState(topic);
  state.artifacts.push({ id, name, type, file: filename });
  writeState(topic, state);

  return file;
}

function artifactCreate(args) {
  if (args.length < 3) throw new Error('usage: session-topic artifact-create <topic> <type> <name-or-spec-id>');
  const [topic, type, nameOrId] = args;
  validateTopicName(topic);
  if (!ARTIFACT_TYPES.includes(type)) throw new Error(`invalid artifact type: ${type}`);

  let file;
  if (type === 'spec') {
    file = createSpec(topic, nameOrId);
  } else if (type === 'plan') {
    file = createPlan(topic, nameOrId);
  } else {
    file = createOtherArtifact(topic, type, nameOrId);
  }

  console.log(file);
}

function planStatus(args) {
  if (args.length < 3) throw new Error('usage: session-topic plan-status <topic> <spec-id> <status>');
  const [topic, id, status] = args;
  validateTopicName(topic);
  if (!PLAN_STATUSES.includes(status)) throw new Error(`invalid plan status: ${status}`);

  const state = readState(topic);
  const spec = state.specs.find((s) => s.id === id);
  if (!spec) throw new Error(`spec ${id} not found`);
  if (!spec.plan) throw new Error(`spec ${id} has no plan; run artifact-create ${topic} plan ${id} first`);
  spec.plan = status;
  writeState(topic, state);

  console.log(status);
}

function worktreePath(args) {
  if (args.length < 1) throw new Error('usage: session-topic worktree-path <topic> [dir]');
  const [topic, dir] = args;
  validateTopicName(topic);
  const repo = resolveRepo(dir || process.cwd());
  console.log(join(topicDir(topic), `worktree-${repo}`));
}

function guardTopic(args) {
  if (args.length < 1) throw new Error('usage: session-topic guard <topic> [dir]');
  const [topic, dir] = args;
  validateTopicName(topic);
  const repo = resolveRepo(dir || process.cwd());
  const expected = join(topicDir(topic), `worktree-${repo}`);
  let expectedResolved;
  try {
    expectedResolved = realpathSync(expected);
  } catch {
    expectedResolved = expected;
  }
  const cwd = realpathSync(process.cwd());
  if (cwd === expectedResolved || cwd.startsWith(expectedResolved + sep)) {
    console.log(`ok: cwd is inside topic worktree ${expectedResolved}`);
    return 0;
  }
  console.error(
    `guard failed: topic-mode code changes must happen inside the topic worktree.\n` +
      `topic: ${topic}\nrepo: ${repo}\nworktree: ${expected}\ncurrent dir: ${cwd}\n` +
      `Create it first (e.g.): git worktree add "${expected}" -b <branch>`
  );
  return 1;
}

function runGit(dir, args) {
  try {
    return execSync(`git ${args}`, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function prRepoMatches(entryRepo, repo) {
  const a = entryRepo.toLowerCase();
  const b = repo.toLowerCase();
  return a === b || a.endsWith(`/${b}`);
}

function printWorktreeCheck(topic, repo, worktree, branch, results, suggestions) {
  console.log(`worktree-check: ${topic}`);
  console.log(`repo: ${repo}`);
  console.log(`worktree: ${worktree}${branch ? ` (branch: ${branch})` : ''}`);
  for (const r of results) console.log(`[${r.status}] ${r.label}: ${r.detail}`);
  for (const line of suggestions) console.log(line);
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  if (fails > 0) {
    console.error(`result: ${fails} FAIL / ${warns} WARN — worktree NOT safe to replace`);
    return 1;
  }
  console.error(`result: ok${warns > 0 ? ` (${warns} WARN)` : ''} — replacement may proceed`);
  return 0;
}

function worktreeCheck(args) {
  const { positional, flags } = splitFlags(args, ['--repo']);
  const [topic] = positional;
  if (!topic || !flags['--repo']) {
    throw new Error('usage: session-topic worktree-check <topic> --repo <main-checkout-path>');
  }
  validateTopicName(topic);
  if (!existsSync(topicDir(topic))) throw new Error(`topic not found: ${topicDir(topic)}`);

  const repoInput = flags['--repo'];
  const repo = basename(repoInput.replace(/[\\/]+$/, '')).replace(/^worktree-/, '');
  const state = readState(topic);
  const worktree = join(topicDir(topic), `worktree-${repo}`);
  const results = [];

  const toplevel = runGit(repoInput, 'rev-parse --show-toplevel');
  if (!toplevel) {
    results.push({ status: 'FAIL', label: 'repo', detail: `${repoInput} is not a git repository` });
    return printWorktreeCheck(topic, repo, worktree, null, results, []);
  }
  results.push({ status: 'PASS', label: 'repo', detail: `${repo} (main checkout: ${toplevel})` });

  const dirExists = existsSync(worktree);
  let branch = null;
  let registered = false;

  if (dirExists) {
    const listing = runGit(repoInput, 'worktree list --porcelain');
    let worktreeReal = null;
    try {
      worktreeReal = realpathSync(worktree);
    } catch {
      worktreeReal = worktree;
    }
    registered =
      !!listing &&
      listing
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .some((l) => {
          try {
            return realpathSync(l.slice(9)) === worktreeReal;
          } catch {
            return false;
          }
        });
    if (registered) {
      results.push({ status: 'PASS', label: 'registered', detail: 'worktree is registered with git' });
    } else {
      results.push({ status: 'FAIL', label: 'registered', detail: `${worktree} exists on disk but is not a registered git worktree (stale directory)` });
    }
  } else {
    results.push({ status: 'PASS', label: 'worktree', detail: 'absent — clean slate for creation' });
  }

  if (registered) {
    branch = runGit(worktree, 'rev-parse --abbrev-ref HEAD');
    const porcelain = runGit(worktree, 'status --porcelain');
    if (porcelain === null) {
      results.push({ status: 'FAIL', label: 'clean tree', detail: `git status failed inside ${worktree}` });
    } else if (porcelain === '') {
      results.push({ status: 'PASS', label: 'clean tree', detail: 'no uncommitted changes' });
    } else {
      const lines = porcelain.split('\n');
      const preview = lines.slice(0, 8).map((l) => l.trim()).join('; ');
      results.push({
        status: 'FAIL',
        label: 'clean tree',
        detail: `${lines.length} dirty entr${lines.length === 1 ? 'y' : 'ies'}: ${preview}${lines.length > 8 ? ' …' : ''}`,
      });
    }

    const upstream = runGit(worktree, 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}');
    const count = upstream ? runGit(worktree, 'rev-list --left-right --count @{upstream}...HEAD') : null;
    if (!upstream || !count) {
      results.push({ status: 'FAIL', label: 'pushed', detail: `branch ${branch} has no upstream — local commits are not safely on the remote` });
    } else {
      const parts = count.split('\t');
      const behind = parts[0] || '0';
      const ahead = parseInt(parts[1] || '0', 10);
      if (ahead > 0) {
        results.push({ status: 'FAIL', label: 'pushed', detail: `${ahead} commit(s) ahead of ${upstream}` });
      } else {
        results.push({ status: 'PASS', label: 'pushed', detail: `in sync with ${upstream} (behind: ${behind})` });
      }
    }

    const prHit = (state.prs || []).find((e) => prRepoMatches(e.repo, repo) && e.branch === branch);
    if (prHit) {
      results.push({ status: 'PASS', label: 'pr registered', detail: `${prHit.repo}#${prHit.number} (${branch})` });
    } else {
      results.push({
        status: 'FAIL',
        label: 'pr registered',
        detail: `branch ${branch} not in STATE.md prs — run: session-topic pr-add ${topic} <owner/${repo}#N> --branch ${branch}`,
      });
    }
  }

  const suggestions = [];
  const defaultRef = runGit(repoInput, 'symbolic-ref --short refs/remotes/origin/HEAD');
  const baseInfo = defaultRef ? runGit(repoInput, `log -1 --format='%h %cd (%cr)' --date=short ${defaultRef}`) : null;
  if (defaultRef && baseInfo) {
    results.push({ status: 'PASS', label: 'baseline', detail: `${defaultRef} @ ${baseInfo}` });
  } else {
    results.push({ status: 'WARN', label: 'baseline', detail: 'origin/HEAD is unset — run gco-latest on the main checkout or resolve the default branch manually before creating a branch' });
  }

  const commonDir = runGit(repoInput, 'rev-parse --git-common-dir');
  if (commonDir) {
    const fetchHead = resolve(repoInput, commonDir, 'FETCH_HEAD');
    try {
      const days = Math.floor((Date.now() - statSync(fetchHead).mtimeMs) / 86400000);
      if (days > 7) {
        results.push({ status: 'WARN', label: 'fetch freshness', detail: `origin last fetched ${days}d ago — run gco-latest before creating a branch` });
      } else {
        results.push({ status: 'PASS', label: 'fetch freshness', detail: `origin fetched ${days}d ago` });
      }
    } catch {
      results.push({ status: 'WARN', label: 'fetch freshness', detail: 'FETCH_HEAD not found — origin has never been fetched from this checkout' });
    }
  }

  suggestions.push('Suggested flow (you execute; pick a fresh <branch> name not registered in STATE.md prs):');
  if (registered) suggestions.push(`  git worktree remove "${worktree}"`);
  suggestions.push(`  git worktree add "${worktree}" -b <branch> ${defaultRef || '<default-branch>'}`);
  suggestions.push(`  node session-topic.mjs guard ${topic}`);

  return printWorktreeCheck(topic, repo, worktree, branch, results, suggestions);
}

function expectedArtifactFilename(name, type) {
  return `${name}.${type}.md`;
}

function parseNumberedMdFile(file) {
  const specMatch = file.match(/^(\d{2,})-(.+)\.spec\.md$/);
  if (specMatch) return { kind: 'spec', id: specMatch[1], name: specMatch[2], type: 'spec' };

  const planMatch = file.match(/^(\d{2,})-(.+)\.plan\.md$/);
  if (planMatch) return { kind: 'plan', id: planMatch[1], name: planMatch[2], type: 'plan' };

  for (const type of NON_SPEC_ARTIFACT_TYPES) {
    const pattern = new RegExp(`^(\\d{2,})-(.+)\\.${type.replace('-', '\\-')}\\.md$`);
    const match = file.match(pattern);
    if (match) return { kind: 'artifact', id: match[1], name: match[2], type };
  }

  const numberedMatch = file.match(/^(\d{2,})-(.+)\.md$/);
  if (numberedMatch) {
    return { kind: 'invalid', id: numberedMatch[1], name: numberedMatch[2], type: null };
  }

  return null;
}

function verifyTopic(args) {
  if (args.length < 1) throw new Error('usage: session-topic verify <topic>');
  const [topic] = args;
  validateTopicName(topic);
  const dir = topicDir(topic);
  if (!existsSync(dir)) {
    console.error(`verify failed: topic directory not found: ${dir}`);
    return 1;
  }

  const state = readState(topic);
  const issues = [];

  const specFiles = [];
  const planFiles = [];
  const artifactFiles = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    if (file === 'STATE.md') continue;

    const numberedMatch = file.match(/^(\d{2,})-.+\.md$/);
    if (!numberedMatch) {
      issues.push(
        `${file} 是未注册的非编号文件(不在 STATE.md 中,且不符合 NN-<name>.<type>.md 命名)。` +
          `修复:删除该文件或移出 topic 目录;持久化 artifact 必须通过 artifact-create 创建`,
      );
      continue;
    }

    const parsed = parseNumberedMdFile(file);
    if (!parsed) continue;

    if (parsed.kind === 'invalid') {
      issues.push(
        `${file} 编号文件名不符合 NN-<name>.<type>.md 格式(类型须为 spec/plan/research/handoff/uat-case/notes)。` +
          `修复:保存内容后删除该文件,再 session-topic artifact-create ${topic} <type> <name> 重建并写回;误建则删除该文件`,
      );
      continue;
    }

    if (parsed.kind === 'spec') {
      specFiles.push({ file, id: parsed.id, name: parsed.name });
    } else if (parsed.kind === 'plan') {
      planFiles.push({ file, id: parsed.id, name: parsed.name });
    } else {
      artifactFiles.push({ file, id: parsed.id, name: parsed.name, type: parsed.type });
    }
  }

  const registeredSpecs = state.specs.map((s) => ({ id: s.id, name: s.name }));

  for (const spec of specFiles) {
    const reg = registeredSpecs.find((s) => s.id === spec.id);
    if (!reg) {
      issues.push(
        `${spec.file} 未注册到 STATE.md(手动创建,未走 artifact-create)。` +
          `修复:内容需保留则先保存内容,再 session-topic artifact-create ${topic} spec ${spec.name} 重建并写回;误建则删除该文件`,
      );
      continue;
    }
    if (reg.name !== spec.name) {
      issues.push(
        `${spec.file} 与 STATE.md 注册名不一致(注册名:${reg.name})。` +
          `修复:对齐 STATE.md 注册名或重命名文件后重跑 verify`,
      );
    }
  }

  for (const plan of planFiles) {
    const specFile = specFiles.find(
      (s) => s.id === plan.id && s.name === plan.name,
    );
    if (!specFile) {
      issues.push(
        `${plan.file} 无对应 spec 文件(${plan.id}-${plan.name}.spec.md 缺失或未注册)。` +
          `修复:session-topic artifact-create ${topic} spec ${plan.name} 创建对应 spec,或删除该 plan 文件`,
      );
    }
  }

  for (const reg of registeredSpecs) {
    const specFile = specFiles.find((s) => s.id === reg.id);
    if (!specFile) {
      issues.push(
        `spec ${reg.id} (${reg.name}) 已注册但 ${reg.id}-${reg.name}.spec.md 不存在。` +
          `修复:session-topic artifact-create ${topic} spec ${reg.name} 重建`,
      );
    }
    const plan = state.specs.find((s) => s.id === reg.id)?.plan;
    if (plan && !PLAN_STATUSES.includes(plan)) {
      issues.push(
        `spec ${reg.id} (${reg.name}) plan 状态非法:${plan}(仅允许 open/implemented)。` +
          `修复:更新 STATE.md plan 字段`,
      );
    }
  }

  const registeredArtifacts = state.artifacts || [];

  for (const artifact of artifactFiles) {
    const reg = registeredArtifacts.find((a) => a.id === artifact.id);
    if (!reg) {
      issues.push(
        `${artifact.file} 未注册到 STATE.md(手动创建,未走 artifact-create)。` +
          `修复:内容需保留则先保存内容,再 session-topic artifact-create ${topic} ${artifact.type} ${artifact.name} 重建并写回;误建则删除该文件`,
      );
      continue;
    }
    if (reg.name !== artifact.name) {
      issues.push(
        `${artifact.file} 与 STATE.md 注册名不一致(注册名:${reg.name})。` +
          `修复:对齐 STATE.md 注册名或重命名文件后重跑 verify`,
      );
    }
    if (reg.type !== artifact.type) {
      issues.push(
        `${artifact.file} 与 STATE.md 注册类型不一致(注册类型:${reg.type})。` +
          `修复:对齐 STATE.md 注册类型或重命名文件后重跑 verify`,
      );
    }
    const expectedFile = `${reg.id}-${expectedArtifactFilename(reg.name, reg.type)}`;
    if (reg.file !== expectedFile) {
      issues.push(
        `artifact ${reg.id} (${reg.name}) STATE.md file 字段(${reg.file})与期望文件名(${expectedFile})不一致。` +
          `修复:对齐 STATE.md file 字段或重命名文件后重跑 verify`,
      );
    }
    if (reg.file !== artifact.file) {
      issues.push(
        `artifact ${reg.id} (${reg.name}) STATE.md file 字段(${reg.file})与磁盘文件(${artifact.file})不一致。` +
          `修复:对齐 STATE.md file 字段或重命名文件后重跑 verify`,
      );
    }
  }

  for (const reg of registeredArtifacts) {
    const artifactFile = artifactFiles.find((a) => a.id === reg.id);
    if (!artifactFile) {
      issues.push(
        `artifact ${reg.id} (${reg.name}, type:${reg.type}) 已注册但 ${reg.file || `${reg.id}-${expectedArtifactFilename(reg.name, reg.type)}`} 不存在。` +
          `修复:session-topic artifact-create ${topic} ${reg.type} ${reg.name} 重建`,
      );
      continue;
    }
    if (reg.type && !NON_SPEC_ARTIFACT_TYPES.includes(reg.type)) {
      issues.push(
        `artifact ${reg.id} (${reg.name}) 注册类型非法:${reg.type}(仅允许 research/handoff/uat-case/notes)。` +
          `修复:更新 STATE.md artifacts 条目`,
      );
    }
  }

  if (state.current_spec && !registeredSpecs.some((s) => s.id === state.current_spec)) {
    issues.push(
      `current_spec 指向 ${state.current_spec},但 specs 列表无此 id。` +
        `修复:更新 STATE.md current_spec 为有效 spec id`,
    );
  }

  if (issues.length > 0) {
    console.error(`verify failed for topic ${topic}:`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    return 1;
  }

  console.log(`ok: ${topic} STATE.md 与 artifact 文件一致`);
  return 0;
}

const CANONICAL_PR_RE = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g;
const PR_URL_RE = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;
const WORKTREE_BULLET_RE = /^\s*-\s*`worktree-([A-Za-z0-9-]+)`/;
const PR_MENTION_RE = /PR\s*\*{0,2}#(\d+)\*{0,2}/gi;
const PR_WITH_REPO_RE = /\b([A-Za-z][A-Za-z0-9_-]*)\s+PR\s*\*{0,2}#(\d+)\*{0,2}/i;
const BODY_BRANCH_RE = /branch\s+`([^`]+)`/gi;
const LAYER_WEIGHTS = { registry: 6, canonical: 5, url: 4, worktree: 3, loose: 2, keyword: 1 };

function splitFlags(args, allowed) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (allowed.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      flags[arg] = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function listTopics() {
  const root = sessionsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'STATE.md')))
    .map((entry) => entry.name);
}

function readTopicForSearch(topic) {
  let raw;
  try {
    raw = readFileSync(join(topicDir(topic), 'STATE.md'), 'utf-8');
  } catch {
    return null;
  }
  try {
    const state = parseState(raw, topic);
    return { title: state.title, prs: state.prs || [], body: state.body };
  } catch {
    return { title: '', prs: [], body: raw };
  }
}

function classifyQuery(query) {
  const url = query.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/);
  if (url) return { kind: 'pr', owner: url[1], repo: url[2], number: url[3] };

  const canonical = query.match(/^(?:([A-Za-z0-9_.-]+)\/)?([A-Za-z0-9_.-]+)#(\d+)$/);
  if (canonical) return { kind: 'pr', owner: canonical[1] || null, repo: canonical[2], number: canonical[3] };

  const bare = query.match(/^#?(\d+)$/);
  if (bare) return { kind: 'pr', owner: null, repo: null, number: bare[1] };

  if (query.includes('/')) return { kind: 'branch', branch: query };

  return { kind: 'keyword', tokens: query.toLowerCase().split(/\s+/).filter(Boolean) };
}

function prRefMatches(candidateRepo, number, query) {
  if (!candidateRepo || number !== query.number) return false;
  if (!query.repo) return true;
  const candidate = candidateRepo.toLowerCase();
  const target = (query.owner ? `${query.owner}/${query.repo}` : query.repo).toLowerCase();
  return candidate === target || candidate.endsWith(`/${target}`) || target.endsWith(`/${candidate}`);
}

function prLineHits(line, query, bulletRepo) {
  const hits = [];
  let match;

  CANONICAL_PR_RE.lastIndex = 0;
  while ((match = CANONICAL_PR_RE.exec(line)) !== null) {
    const repo = `${match[1]}/${match[2]}`;
    if (prRefMatches(repo, match[3], query)) {
      hits.push({ layer: 'canonical', pr: `${repo}#${match[3]}`, repoFull: repo, snippet: line.trim(), repoShort: match[2] });
    }
  }

  PR_URL_RE.lastIndex = 0;
  while ((match = PR_URL_RE.exec(line)) !== null) {
    const repo = `${match[1]}/${match[2]}`;
    if (prRefMatches(repo, match[3], query)) {
      hits.push({ layer: 'url', pr: `${repo}#${match[3]}`, repoFull: repo, snippet: line.trim(), repoShort: match[2] });
    }
  }

  PR_MENTION_RE.lastIndex = 0;
  while ((match = PR_MENTION_RE.exec(line)) !== null) {
    if (bulletRepo) {
      if (prRefMatches(bulletRepo, match[1], query)) {
        hits.push({ layer: 'worktree', pr: `${bulletRepo}#${match[1]}`, repoFull: null, snippet: line.trim(), repoShort: bulletRepo });
      }
      continue;
    }
    const withRepo = line.match(PR_WITH_REPO_RE);
    if (withRepo && prRefMatches(withRepo[1], match[1], query)) {
      hits.push({ layer: 'loose', pr: `${withRepo[1]}#${match[1]}`, repoFull: null, snippet: line.trim(), repoShort: withRepo[1] });
    } else if (!query.repo) {
      hits.push({ layer: 'loose', pr: `#${match[1]}`, repoFull: null, snippet: line.trim(), repoShort: null });
    }
  }

  return hits;
}

function scanPr(data, query) {
  const hits = [];
  for (const entry of data.prs) {
    if (prRefMatches(entry.repo, entry.number, query)) {
      hits.push({
        layer: 'registry',
        pr: `${entry.repo}#${entry.number}`,
        repoFull: entry.repo,
        snippet: entry.branch ? `branch: ${entry.branch}` : 'frontmatter prs entry',
        repoShort: entry.repo.split('/')[1],
      });
    }
  }
  for (const line of data.body.split('\n')) {
    const bullet = line.match(WORKTREE_BULLET_RE);
    hits.push(...prLineHits(line, query, bullet ? bullet[1] : null));
  }
  return hits;
}

function scanBranch(data, branchQuery) {
  const hits = [];
  const lower = branchQuery.toLowerCase();
  for (const entry of data.prs) {
    if (entry.branch && entry.branch.toLowerCase().includes(lower)) {
      hits.push({
        layer: 'registry',
        detail: 'branch',
        pr: `${entry.repo}#${entry.number}`,
        repoFull: entry.repo,
        snippet: `branch: ${entry.branch}`,
        repoShort: entry.repo.split('/')[1],
      });
    }
  }
  for (const line of data.body.split('\n')) {
    BODY_BRANCH_RE.lastIndex = 0;
    let match;
    while ((match = BODY_BRANCH_RE.exec(line)) !== null) {
      if (match[1].toLowerCase().includes(lower)) {
        const bullet = line.match(WORKTREE_BULLET_RE);
        hits.push({ layer: 'worktree', detail: 'branch', pr: null, snippet: line.trim(), repoShort: bullet ? bullet[1] : null });
      }
    }
  }
  if (hits.length === 0) {
    const line = data.body.split('\n').find((l) => l.toLowerCase().includes(lower));
    if (line) hits.push({ layer: 'keyword', pr: null, snippet: line.trim(), repoShort: null });
  }
  return hits;
}

function scanKeyword(data, tokens, topic) {
  const nameText = topic.slice(11).replace(/-/g, ' ').toLowerCase();
  const titleText = (data.title || '').toLowerCase();
  const lines = data.body.split('\n');
  const headingText = lines.filter((l) => l.trim().startsWith('#')).join('\n').toLowerCase();
  const bodyText = data.body.toLowerCase();

  const allIn = (text) => tokens.every((t) => text.includes(t));
  const anywhere = tokens.every((t) => nameText.includes(t) || titleText.includes(t) || bodyText.includes(t));
  if (!anywhere) return [];

  let detail = 'scattered';
  if (allIn(`${nameText} ${titleText}`)) detail = 'title';
  else if (allIn(headingText)) detail = 'heading';
  else if (allIn(bodyText)) detail = 'body';

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const matchesAll = (l) => tokens.every((t) => l.toLowerCase().includes(t));
  const snippetLine =
    lines.find(matchesAll) ||
    lines.find((l) => l.toLowerCase().includes(first)) ||
    lines.find((l) => l.toLowerCase().includes(last)) ||
    '';
  return [{ layer: 'keyword', detail, pr: null, snippet: snippetLine.trim(), repoShort: null }];
}

function buildCandidate(topic, data, hits) {
  const byNumber = new Map();
  for (const hit of hits) {
    const numberMatch = hit.pr ? hit.pr.match(/#(\d+)$/) : null;
    if (!numberMatch) continue;
    const number = numberMatch[1];
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(hit);
  }

  const prLabels = [];
  let top = null;
  const promote = (hit) => {
    if (!top || LAYER_WEIGHTS[hit.layer] > LAYER_WEIGHTS[top.layer]) top = hit;
  };

  for (const [number, bucket] of byNumber) {
    const confirmed = bucket.filter((h) => h.repoFull);
    const bestHit = (confirmed.length > 0 ? confirmed : bucket).reduce((a, b) =>
      LAYER_WEIGHTS[a.layer] >= LAYER_WEIGHTS[b.layer] ? a : b,
    );
    promote(bestHit);
    const repo = bestHit.repoFull || bestHit.repoShort;
    const label = `${repo || ''}#${number}${bestHit.layer === 'loose' ? ' [unconfirmed]' : ''}`;
    if (!prLabels.includes(label)) prLabels.push(label);
  }

  if (!top) {
    top = hits.reduce((a, b) => (LAYER_WEIGHTS[a.layer] >= LAYER_WEIGHTS[b.layer] ? a : b));
  }

  const repoShorts = [...new Set(hits.map((h) => h.repoShort).filter(Boolean))];
  return {
    topic,
    title: data.title,
    layer: `${top.layer}${top.detail ? `/${top.detail}` : ''}`,
    prs: prLabels,
    snippet: top.snippet,
    worktrees: repoShorts.map((r) => `${r}:${existsSync(join(topicDir(topic), `worktree-${r}`)) ? 'present' : 'absent'}`),
    weight: LAYER_WEIGHTS[top.layer],
  };
}

function printCandidate(candidate) {
  console.log(`${candidate.topic}  [${candidate.layer}]`);
  console.log(`  ${topicDir(candidate.topic)}`);
  if (candidate.prs.length > 0) console.log(`  pr: ${candidate.prs.join(' | ')}`);
  if (candidate.title) console.log(`  title: ${candidate.title}`);
  if (candidate.worktrees.length > 0) console.log(`  worktree: ${candidate.worktrees.join(' | ')}`);
  if (candidate.snippet) console.log(`  > ${candidate.snippet.slice(0, 160)}`);
}

function repoFilterMatches(topic, data, repoArg) {
  const r = repoArg.toLowerCase();
  if (data.prs.some((e) => e.repo.toLowerCase() === r || e.repo.toLowerCase().endsWith(`/${r}`))) return true;
  return existsSync(join(topicDir(topic), `worktree-${repoArg}`));
}

function findTopics(args) {
  const { positional, flags } = splitFlags(args, ['--repo', '--since', '--until']);
  if (positional.length < 1) {
    throw new Error('usage: session-topic find <query> [--repo <repo>] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]');
  }
  for (const flag of ['--since', '--until']) {
    if (flags[flag] && !/^\d{4}-\d{2}-\d{2}$/.test(flags[flag])) {
      throw new Error(`invalid ${flag} date (expected YYYY-MM-DD): ${flags[flag]}`);
    }
  }

  const query = classifyQuery(positional.join(' '));
  const candidates = [];
  for (const topic of listTopics()) {
    const date = topic.slice(0, 10);
    if (flags['--since'] && date < flags['--since']) continue;
    if (flags['--until'] && date > flags['--until']) continue;

    const data = readTopicForSearch(topic);
    if (!data) continue;
    if (flags['--repo'] && !repoFilterMatches(topic, data, flags['--repo'])) continue;

    let hits = [];
    if (query.kind === 'pr') hits = scanPr(data, query);
    else if (query.kind === 'branch') hits = scanBranch(data, query.branch);
    else hits = scanKeyword(data, query.tokens, topic);
    if (hits.length === 0) continue;

    candidates.push(buildCandidate(topic, data, hits));
  }

  if (candidates.length === 0) {
    console.error(`no topic matched: ${positional.join(' ')}`);
    return 1;
  }

  candidates.sort((a, b) => b.weight - a.weight || (a.topic < b.topic ? 1 : -1));
  for (const candidate of candidates) printCandidate(candidate);
  console.error(`${candidates.length} candidate(s)`);
  return 0;
}

function parsePrRef(ref) {
  const url = ref.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: url[3] };
  const canonical = ref.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/);
  if (canonical) return { repo: `${canonical[1]}/${canonical[2]}`, number: canonical[3] };
  throw new Error(`invalid PR ref: ${ref}; use a PR URL or owner/repo#N`);
}

function prAdd(args) {
  const { positional, flags } = splitFlags(args, ['--branch']);
  const [topic, ref] = positional;
  if (!topic || !ref) {
    throw new Error('usage: session-topic pr-add <topic> <pr-url|owner/repo#N> [--branch <branch>]');
  }
  validateTopicName(topic);
  if (!existsSync(topicDir(topic))) throw new Error(`topic not found: ${topicDir(topic)}`);
  const parsed = parsePrRef(ref);
  const state = readState(topic);
  const existing = state.prs.find(
    (e) => e.repo.toLowerCase() === parsed.repo.toLowerCase() && e.number === parsed.number,
  );
  if (existing) {
    if (!flags['--branch']) {
      console.log(`already registered: ${existing.repo}#${existing.number} in ${topic}`);
      return;
    }
    existing.branch = flags['--branch'];
  } else {
    state.prs.push({ repo: parsed.repo, number: parsed.number, branch: flags['--branch'] || null });
  }
  writeState(topic, state);
  console.log(`registered: ${parsed.repo}#${parsed.number}${flags['--branch'] ? ` (branch: ${flags['--branch']})` : ''} -> ${topic}`);
}

function help() {
  console.log(`Usage: session-topic <command> [args]

Commands:
  init <semantic-hint>              Create a new topic and print its name
  resolve <topic>                   Print the absolute path of a topic directory
  artifact-create <topic> <type> <name-or-spec-id>
                                    Create a numbered artifact file and update STATE.md
                                    Types: spec | plan | research | handoff | uat-case | notes
                                    For plan, <name-or-spec-id> is the spec id (reuses spec number/name)
  plan-status <topic> <spec-id> <status>  Update plan status (open|implemented)
  verify <topic>                  Verify STATE.md matches artifact files; exit 1 on drift
  worktree-path <topic> [dir]   Print the worktree path for the repo at $PWD or [dir]
  worktree-check <topic> --repo <main-checkout-path>
                                Read-only preflight before creating/replacing the worktree:
                                clean gate + pushed/PR report + baseline snapshot; exit 1 on FAIL
  guard <topic> [dir]           Assert $PWD is inside the topic worktree for the repo; exit 1 if not
  find <query> [--repo r] [--since d] [--until d]
                                Locate topics by PR URL, owner/repo#N, bare #N, branch, or keyword;
                                searches STATE.md files only, prints ranked candidates, exit 1 on no match
  pr-add <topic> <pr-url|owner/repo#N> [--branch b]
                                Register a PR in the topic frontmatter prs index (idempotent)
`);
}

function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '-h' || command === '--help') {
    help();
    return 0;
  }

  if (!COMMANDS.includes(command)) throw new Error(`unknown command: ${command}`);

  let code = 0;
  switch (command) {
    case 'init': init(args); break;
    case 'resolve': resolveTopic(args); break;
    case 'artifact-create': artifactCreate(args); break;
    case 'plan-status': planStatus(args); break;
    case 'verify': code = verifyTopic(args); break;
    case 'worktree-path': worktreePath(args); break;
    case 'worktree-check': code = worktreeCheck(args); break;
    case 'guard': code = guardTopic(args); break;
    case 'find': code = findTopics(args); break;
    case 'pr-add': prAdd(args); break;
  }

  return code;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
