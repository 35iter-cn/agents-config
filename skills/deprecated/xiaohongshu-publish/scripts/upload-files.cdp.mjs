#!/usr/bin/env node
/**
 * Upload files to a page's first <input type=file> via Chrome DevTools Protocol.
 * Workaround for MCP upload_file workspace-root restrictions on WSL paths.
 *
 * Usage:
 *   node upload-files.cdp.mjs --page-url creator.xiaohongshu.com/publish --files a.jpg,b.jpg
 *   node upload-files.cdp.mjs --page-id PAGE_ID --files /abs/a.jpg,/abs/b.jpg
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1:9222';

function usage() {
  console.error(`Usage: upload-files.cdp.mjs (--page-url SUBSTR | --page-id ID) --files path1,path2,...`);
  process.exit(2);
}

function parseArgs(argv) {
  let pageUrl = null;
  let pageId = null;
  let files = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--page-url') pageUrl = argv[++i];
    else if (arg === '--page-id') pageId = argv[++i];
    else if (arg === '--files') files = argv[++i];
    else if (arg === '-h' || arg === '--help') usage();
    else {
      console.error(`Unknown arg: ${arg}`);
      usage();
    }
  }

  if (!files || (!pageUrl && !pageId)) usage();

  const paths = files.split(',').map((p) => resolve(p.trim()));
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(1);
    }
  }

  return { pageUrl, pageId, files: paths };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function cdpSession(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();

  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  };

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  return { call, close: () => ws.close() };
}

async function main() {
  const { pageUrl, pageId, files } = parseArgs(process.argv.slice(2));

  const targets = await fetchJson(`http://${CDP_HOST}/json/list`);
  let target;

  if (pageId) {
    target = targets.find((t) => t.id === pageId);
  } else {
    target = targets.find((t) => t.url && t.url.includes(pageUrl));
  }

  if (!target?.webSocketDebuggerUrl) {
    console.error('Page not found in CDP targets.');
    console.error('Available:', targets.map((t) => `${t.id} ${t.url}`).join('\n'));
    process.exit(1);
  }

  const session = await cdpSession(target.webSocketDebuggerUrl);

  try {
    const doc = await session.call('DOM.getDocument', { depth: -1 });
    const qa = await session.call('DOM.querySelectorAll', {
      nodeId: doc.root.nodeId,
      selector: 'input[type=file]',
    });

    if (!qa.nodeIds?.length) {
      throw new Error('No input[type=file] on page — switch to 上传图文 first');
    }

    await session.call('DOM.setFileInputFiles', {
      nodeId: qa.nodeIds[0],
      files,
    });

    console.log(JSON.stringify({ ok: true, page: target.url, files, inputCount: qa.nodeIds.length }));
  } finally {
    session.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
