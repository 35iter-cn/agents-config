#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opts = { branch: 'pr-assets', section: 'Screenshots / Videos', files: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') opts.repo = args[++i];
  else if (args[i] === '--pr') opts.pr = args[++i];
  else if (args[i] === '--branch') opts.branch = args[++i];
  else if (args[i] === '--dir') opts.dir = args[++i];
  else if (args[i] === '--section') opts.section = args[++i];
  else opts.files.push(args[i]);
}
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };
if (!opts.files.length) fail('no image files given. usage: attach-pr-images.mjs --repo owner/repo --pr N [--branch pr-assets] [--dir pr-N] [--section "Screenshots / Videos"] files...');

const gh = (ghArgs, input) =>
  execFileSync('gh', ghArgs, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const api = (path, method = 'GET', body) =>
  gh(['api', path, '-X', method, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined);

opts.repo ||= gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
opts.dir ||= opts.pr ? `pr-${opts.pr}` : 'misc';

for (const f of opts.files) {
  if (!/^[\w.-]+$/.test(basename(f))) fail(`unsafe filename: ${f} (allowed: letters, digits, _ . -)`);
}

let branchExists = true;
try {
  api(`repos/${opts.repo}/git/ref/heads/${opts.branch}`);
} catch {
  branchExists = false;
}
if (!branchExists) {
  const defaultBranch = JSON.parse(api(`repos/${opts.repo}`)).default_branch;
  const { object } = JSON.parse(api(`repos/${opts.repo}/git/ref/heads/${defaultBranch}`));
  api(`repos/${opts.repo}/git/refs`, 'POST', { ref: `refs/heads/${opts.branch}`, sha: object.sha });
  console.error(`created branch ${opts.branch} from ${defaultBranch}`);
}

const uploaded = [];
for (const file of opts.files) {
  const name = basename(file);
  const path = `${opts.dir}/${name}`;
  const content = readFileSync(file).toString('base64');
  let sha;
  try {
    sha = JSON.parse(api(`repos/${opts.repo}/contents/${path}?ref=${opts.branch}`)).sha;
  } catch {}
  api(`repos/${opts.repo}/contents/${path}`, 'PUT', {
    message: `${opts.dir}: ${name}`,
    content,
    branch: opts.branch,
    ...(sha ? { sha } : {}),
  });
  uploaded.push({ name, path });
  console.error(`uploaded ${path}`);
}

const token = gh(['auth', 'token']);
for (const { path } of uploaded) {
  const url = `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/${path}`;
  const code = execFileSync(
    'curl',
    ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', `Authorization: token ${token}`, url],
    { encoding: 'utf8' }
  ).trim();
  if (code !== '200') console.error(`WARN: ${path} not servable (HTTP ${code})`);
}

const markdown = uploaded.map(
  ({ name, path }) => `![${name.replace(/\.[^.]+$/, '')}](https://github.com/${opts.repo}/raw/${opts.branch}/${path})`
);

if (opts.pr) {
  const body = gh(['pr', 'view', opts.pr, '--repo', opts.repo, '--json', 'body', '-q', '.body']);
  const block = `## ${opts.section}\n\n${markdown.join('\n\n')}`;
  const bodyLines = body.split('\n');
  const start = bodyLines.findIndex((l) => l.trim() === `## ${opts.section}`);
  let next;
  if (start === -1) {
    next = `${body.trimEnd()}\n\n${block}\n`;
  } else {
    let end = bodyLines.findIndex((l, i) => i > start && l.startsWith('## '));
    if (end === -1) end = bodyLines.length;
    next = [...bodyLines.slice(0, start), block, '', ...bodyLines.slice(end)].join('\n');
  }
  const file = join(tmpdir(), `pr-body-${opts.pr}.md`);
  writeFileSync(file, next);
  gh(['pr', 'edit', opts.pr, '--repo', opts.repo, '--body-file', file]);
  console.error(`updated PR #${opts.pr} section "${opts.section}"`);
}

console.log(markdown.join('\n\n'));
