import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const MODEL_MAP_PATH = join(homedir(), '.config', 'companions', 'model-map.json');
const EMPTY_CONFIG = Object.freeze({ opencode: {}, cursor: {}, omp: {}, codex: {} });
const ALLOWED_ADAPTORS = ['opencode', 'cursor', 'omp', 'codex'];


export function resolveModelFromConfig(config, tier) {
  if (tier === undefined || tier === null) {
    return undefined;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined;
  }
  return config[tier];
}

export function resolveModel(adaptor, tier) {
  if (tier === undefined || tier === null) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(MODEL_MAP_PATH, 'utf8'));
    return resolveModelFromConfig(parsed?.[adaptor], tier);
  } catch {
    return undefined;
  }
}

function cloneEmptyConfig() {
  return {
    opencode: {},
    cursor: {},
    omp: {},
    codex: {},
  };
}

function readConfig(path = MODEL_MAP_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return cloneEmptyConfig();
    }
  return {
    opencode: parsed.opencode && typeof parsed.opencode === 'object' && !Array.isArray(parsed.opencode)
      ? { ...parsed.opencode }
      : {},
    cursor: parsed.cursor && typeof parsed.cursor === 'object' && !Array.isArray(parsed.cursor)
      ? { ...parsed.cursor }
      : {},
    omp: parsed.omp && typeof parsed.omp === 'object' && !Array.isArray(parsed.omp)
      ? { ...parsed.omp }
      : {},
    codex: parsed.codex && typeof parsed.codex === 'object' && !Array.isArray(parsed.codex)
      ? { ...parsed.codex }
      : {},
  };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      process.stderr.write(`Warning: failed to read model-map.json: ${error.message}\n`);
    }
    return cloneEmptyConfig();
  }
}

function parseOpencodeModels(stdout) {
  return String(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes('/') && !line.endsWith(':'));
}

function extractProviders(modelIds) {
  const providers = new Set();
  for (const id of modelIds) {
    const slashIndex = id.indexOf('/');
    if (slashIndex > 0) {
      providers.add(id.slice(0, slashIndex));
    }
  }
  return Array.from(providers).sort();
}

function parseCursorModels(stdout) {
  return String(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^Available models/i.test(line))
    .map((line) => line.split(' - ')[0].trim())
    .filter(Boolean);
}

function parseOmpModels(stdout) {
  const lines = String(stdout).split('\n');
  const models = [];
  let inCanonical = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'Canonical models') {
      inCanonical = true;
      continue;
    }
    if (inCanonical) {
      // Skip separator line (dashes)
      if (/^[- ]+$/.test(trimmed)) {
        continue;
      }
      // Stop at empty line or next section
      if (!trimmed || trimmed.startsWith('Provider')) {
        break;
      }
      // Split by 2+ spaces and take 2nd column (selected model ID)
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length >= 2) {
        const modelId = parts[1].trim();
        if (modelId) {
          models.push(modelId);
        }
      }
    }
  }
  return models;
}

function execFileText(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function validateConfigShape(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be an object');
  }

  for (const [adaptor, value] of Object.entries(config)) {
    if (!ALLOWED_ADAPTORS.includes(adaptor)) {
      throw new Error(`Unsupported adaptor: ${adaptor}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Config for adaptor '${adaptor}' must be an object`);
    }
    for (const [tier, model] of Object.entries(value)) {
      if (typeof model !== 'string') {
        throw new Error(`Model for ${adaptor}.${tier} must be a string`);
      }
    }
  }
}

export async function listModels() {
  const configured = readConfig();
  const available = {
    opencode: [],
    cursor: [],
    omp: [],
    codex: [],
  };

  try {
    available.opencode = parseOpencodeModels(await execFileText('opencode', ['models']));
  } catch (error) {
    process.stderr.write(`Warning: failed to list opencode models: ${error.message}\n`);
  }

  try {
    available.cursor = parseCursorModels(await execFileText('cursor-agent', ['--list-models']));
  } catch (error) {
    process.stderr.write(`Warning: failed to list cursor models: ${error.message}\n`);
  }

  try {
    available.omp = parseOmpModels(await execFileText('omp', ['--list-models']));
  } catch (error) {
    process.stderr.write(`Warning: failed to list omp models: ${error.message}\n`);
  }

  // codex has no --list-models subcommand; model config comes from model-map.json

  const providers = {
    opencode: extractProviders(available.opencode),
    cursor: extractProviders(available.cursor),
    omp: extractProviders(available.omp),
    codex: [],
  };

  return { configured, available, providers };
}
export function setModels(config) {
  try {
    validateConfigShape(config);
    const existing = readConfig();
    const merged = {
      ...existing,
      opencode: config.opencode ? { ...existing.opencode, ...config.opencode } : existing.opencode,
      cursor: config.cursor ? { ...existing.cursor, ...config.cursor } : existing.cursor,
      omp: config.omp ? { ...existing.omp, ...config.omp } : existing.omp,
      codex: config.codex ? { ...existing.codex, ...config.codex } : existing.codex,
    };

    const tempPath = `${MODEL_MAP_PATH}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(merged, null, 2)}\n`);
    renameSync(tempPath, MODEL_MAP_PATH);
    return { type: 'done', success: true };
  } catch (error) {
    return {
      type: 'done',
      success: false,
      error: error.message,
    };
  }
}

export function getModels(adaptor, configPath = MODEL_MAP_PATH) {
  const config = readConfig(configPath);
  if (adaptor && ALLOWED_ADAPTORS.includes(adaptor)) {
    return {
      opencode: adaptor === 'opencode' ? { ...config.opencode } : {},
      cursor: adaptor === 'cursor' ? { ...config.cursor } : {},
      omp: adaptor === 'omp' ? { ...config.omp } : {},
      codex: adaptor === 'codex' ? { ...config.codex } : {},
    };
  }
  return {
    opencode: { ...config.opencode },
    cursor: { ...config.cursor },
    omp: { ...config.omp },
    codex: { ...config.codex },
  };
}

export function resetModels(adaptor, configPath = MODEL_MAP_PATH) {
  try {
    const existing = readConfig(configPath);
    const cleared = { ...existing };

    if (adaptor === 'both' || adaptor === undefined) {
      cleared.opencode = {};
      cleared.cursor = {};
      cleared.omp = {};
      cleared.codex = {};
    } else if (ALLOWED_ADAPTORS.includes(adaptor)) {
      cleared[adaptor] = {};
    } else {
      throw new Error(`Unsupported adaptor: ${adaptor}`);
    }

    const tempPath = `${configPath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(cleared, null, 2)}\n`);
    renameSync(tempPath, configPath);
    return { type: 'done', success: true };
  } catch (error) {
    return { type: 'done', success: false, error: error.message };
  }
}
