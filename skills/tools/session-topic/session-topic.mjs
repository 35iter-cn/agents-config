#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ADJECTIVES } from '../../companions/scripts/lib/words/adjectives.mjs';
import { NOUNS } from '../../companions/scripts/lib/words/nouns.mjs';

const COMMANDS = ['init', 'resolve', 'spec-create', 'plan-create', 'spec-status', 'worktree-path'];
const STATUSES = ['open', 'merged', 'closed'];

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

function parseState(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return { topic: '', title: '', created: today(), current_spec: '', specs: [], body: content };
  }

  const endIndex = lines.indexOf('---', 1);
  if (endIndex === -1) {
    return { topic: '', title: '', created: today(), current_spec: '', specs: [], body: content };
  }

  const frontmatter = lines.slice(1, endIndex).join('\n');
  const body = lines.slice(endIndex + 1).join('\n').replace(/^\n+/, '');

  const state = { topic: '', title: '', created: today(), current_spec: '', specs: [] };
  let currentSpec = null;
  let inSpecs = false;

  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed === 'specs:') {
      inSpecs = true;
      currentSpec = null;
      continue;
    }

    if (inSpecs) {
      const listMatch = trimmed.match(/^- id:\s*(.+)$/);
      if (listMatch) {
        currentSpec = { id: listMatch[1].trim(), name: '', status: 'open' };
        state.specs.push(currentSpec);
        continue;
      }

      if (currentSpec) {
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          const key = trimmed.slice(0, colonIndex).trim();
          const value = trimmed.slice(colonIndex + 1).trim();
          if (key === 'name' || key === 'status') currentSpec[key] = value;
        }
        continue;
      }

      inSpecs = false;
    }

    currentSpec = null;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (['topic', 'title', 'created', 'current_spec'].includes(key)) {
      state[key] = value;
    }
  }

  return { ...state, body };
}

function formatSpec(spec) {
  return `  - id: ${spec.id}\n    name: ${spec.name}\n    status: ${spec.status}`;
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
    '---',
    '',
    state.body,
  ].join('\n');
}

function readState(topic) {
  const path = join(topicDir(topic), 'STATE.md');
  if (!existsSync(path)) {
    return { topic, title: '', created: today(), current_spec: '', specs: [], body: '' };
  }
  return parseState(readFileSync(path, 'utf-8'));
}

function writeState(topic, state) {
  const dir = topicDir(topic);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'STATE.md'), formatState(state));
}

function parseSpecNumber(filename) {
  const match = filename.match(/^(\d{2,})-/);
  return match ? parseInt(match[1], 10) : 0;
}

function nextSpecNumber(topic) {
  const state = readState(topic);
  const numbers = state.specs.map((s) => parseInt(s.id, 10));
  const dir = topicDir(topic);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const n = parseSpecNumber(file);
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

function specCreate(args) {
  if (args.length < 2) throw new Error('usage: session-topic spec-create <topic> <spec-name>');
  const [topic, name] = args;
  validateTopicName(topic);
  const id = nextSpecNumber(topic);
  const dir = topicDir(topic);
  const file = join(dir, `${id}-${name}.spec.md`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, '');

  const state = readState(topic);
  state.specs.push({ id, name, status: 'open' });
  state.current_spec = id;
  writeState(topic, state);

  console.log(file);
}

function planCreate(args) {
  if (args.length < 2) throw new Error('usage: session-topic plan-create <topic> <spec-id>');
  const [topic, id] = args;
  validateTopicName(topic);
  const name = specName(topic, id);
  const dir = topicDir(topic);
  const file = join(dir, `${id}-${name}.plan.md`);

  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '');

  console.log(file);
}

function specStatus(args) {
  if (args.length < 3) throw new Error('usage: session-topic spec-status <topic> <spec-id> <status>');
  const [topic, id, status] = args;
  validateTopicName(topic);
  if (!STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);

  const state = readState(topic);
  const spec = state.specs.find((s) => s.id === id);
  if (!spec) throw new Error(`spec ${id} not found`);
  spec.status = status;
  writeState(topic, state);

  console.log(status);
}

function worktreePath(args) {
  if (args.length < 2) throw new Error('usage: session-topic worktree-path <topic> <repo>');
  const [topic, repo] = args;
  validateTopicName(topic);
  console.log(join(topicDir(topic), `worktree-${repo}`));
}

function help() {
  console.log(`Usage: session-topic <command> [args]

Commands:
  init <semantic-hint>              Create a new topic and print its name
  resolve <topic>                   Print the absolute path of a topic directory
  spec-create <topic> <spec-name>   Create a numbered spec file and update STATE.md
  plan-create <topic> <spec-id>     Create a plan file for an existing spec
  spec-status <topic> <spec-id> <status>  Update spec status (open|merged|closed)
  worktree-path <topic> <repo>      Print the worktree path for a repo
`);
}

function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '-h' || command === '--help') {
    help();
    return 0;
  }

  if (!COMMANDS.includes(command)) throw new Error(`unknown command: ${command}`);

  switch (command) {
    case 'init': init(args); break;
    case 'resolve': resolveTopic(args); break;
    case 'spec-create': specCreate(args); break;
    case 'plan-create': planCreate(args); break;
    case 'spec-status': specStatus(args); break;
    case 'worktree-path': worktreePath(args); break;
  }

  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
