#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { ADJECTIVES } from './words/adjectives.mjs';
import { NOUNS } from './words/nouns.mjs';

const COMMANDS = ['init', 'resolve', 'artifact-create', 'plan-status', 'verify', 'worktree-path', 'guard'];
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

  const state = { topic: '', title: '', created: today(), current_spec: '', specs: [], artifacts: [] };
  let currentSpec = null;
  let currentArtifact = null;
  let inSpecs = false;
  let inArtifacts = false;

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

    currentSpec = null;
    currentArtifact = null;
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

function formatState(state) {
  return [
    '---',
    `topic: ${state.topic}`,
    `title: ${state.title}`,
    `created: ${state.created}`,
    `current_spec: ${state.current_spec}`,
    'specs:',
    ...state.specs.map(formatSpec),
    'artifacts:',
    ...state.artifacts.map(formatArtifact),
    '---',
    '',
    state.body,
  ].join('\n');
}

function readState(topic) {
  const path = join(topicDir(topic), 'STATE.md');
  if (!existsSync(path)) {
    return { topic, title: '', created: today(), current_spec: '', specs: [], artifacts: [], body: '' };
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
  guard <topic> [dir]           Assert $PWD is inside the topic worktree for the repo; exit 1 if not
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
    case 'guard': code = guardTopic(args); break;
  }

  return code;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
