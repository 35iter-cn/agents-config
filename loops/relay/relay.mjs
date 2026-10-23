#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCore, defaultLog } from "./core.mjs";
import { defineAdapter, isPlatform, PLATFORMS } from "./platform.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;
const CFG_DIR = join(HOME, ".config/taskradar");

export function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

export const paths = {
  home: HOME,
  cwd: join(HOME, "code"),
  configDir: CFG_DIR,
  logDir: join(CFG_DIR, "logs"),
  sessionsDir: join(HOME, ".pi/agent/sessions", `--${join(HOME, "code").replace(/^\//, "").replace(/[/\\:]/g, "-")}--`),
  promptFile: join(ROOT, "prompts/thread.md"),
};

export function usage() {
  process.stderr.write("usage: relay.mjs <feishu|slack|telegram> | relay.mjs notify <feishu|telegram> <text>\n");
  process.exit(2);
}

async function loadAdapter(platform) {
  const module = await import(`./adapters/${platform}.mjs`);
  return defineAdapter(module.createAdapter({ paths, readEnv, log: defaultLog }));
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "notify") {
    const [platform, ...words] = rest;
    if (!isPlatform(platform)) usage();
    const text = words.join(" ").trim();
    if (!text) usage();
    const adapter = await loadAdapter(platform);
    if (typeof adapter.notify !== "function") {
      process.stderr.write(`platform ${platform} does not support notify\n`);
      process.exit(2);
    }
    await adapter.notify(text);
    return;
  }
  if (!isPlatform(mode)) usage();

  const adapter = await loadAdapter(mode);
  const platformPaths = {
    ...paths,
    stateFile: join(CFG_DIR, `relay-${mode}.json`),
  };
  const core = createCore({ adapter, paths: platformPaths });
  core.pruneLogs();
  setInterval(() => core.pruneLogs(), 86_400_000).unref();
  await adapter.start({
    onMessage: (inbound) => core.handle(inbound),
    onReady: () => {
      core.recover().catch((error) => defaultLog("error", "recover", String(error?.stack ?? error)));
    },
    core,
  });
}

if (import.meta.main) {
  main().catch((error) => {
    defaultLog("error", "fatal", String(error?.stack ?? error));
    process.exit(1);
  });
}
