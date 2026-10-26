#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandDirFor, createCore, defaultLog } from "./core.mjs";
import { createJev } from "./jev.mjs";
import { createUsage } from "./usage.mjs";
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
  stallFile: join(ROOT, "prompts/stall.md"),
  candidateRulesFile: join(ROOT, "prompts/candidate-rules.md"),
  stallActionsFile: join(ROOT, "prompts/stall-actions.md"),
};

export const STALL_ACTIONS = new Set(["cancel", "restart"]);

export function usage() {
  process.stderr.write(
    "usage: relay.mjs <feishu|slack|telegram> | relay.mjs notify <feishu|telegram> <text> | relay.mjs stall <platform> <cancel|restart> <key> [text]\n",
  );
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
  if (mode === "stall") {
    const [platform, action, key, ...words] = rest;
    if (!isPlatform(platform)) usage();
    const wire = STALL_ACTIONS.has(action) ? action : null;
    if (!wire) usage();
    if (!key) usage();
    const dir = commandDirFor(paths.configDir, platform);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${process.pid}.json`);
    const command = { action: wire, key, text: words.join(" ").trim(), at: new Date().toISOString() };
    writeFileSync(file, `${JSON.stringify(command)}\n`, { encoding: "utf8", mode: 0o600 });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && existsSync(file)) await new Promise((resolve) => setTimeout(resolve, 500));
    process.stdout.write(existsSync(file) ? "pending\n" : "delivered\n");
    return;
  }
  if (!isPlatform(mode)) usage();

  const adapter = await loadAdapter(mode);
  const platformPaths = {
    ...paths,
    stateFile: join(CFG_DIR, `relay-${mode}.json`),
  };
  const jev = createJev({ env: { ...process.env, ...readEnv(join(CFG_DIR, "jev.env")) }, log: defaultLog });
  const usageRecorder = createUsage({ dir: join(paths.logDir, mode), judge: jev, log: defaultLog });
  const core = createCore({ adapter, paths: platformPaths, deps: { jev, usage: usageRecorder } });
  core.pruneLogs();
  setInterval(() => core.pruneLogs(), 86_400_000).unref();
  core.drainCommands().catch((error) => defaultLog("error", "command", String(error?.stack ?? error)));
  setInterval(
    () => core.drainCommands().catch((error) => defaultLog("error", "command", String(error?.stack ?? error))),
    15_000,
  ).unref();
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
