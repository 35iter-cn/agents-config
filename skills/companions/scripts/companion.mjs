import { fstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCompanion as defaultRunCompanion } from './lib/runner.mjs';

export function isDirectExecution(moduleUrl, argv1, cwd = process.cwd()) {
  if (!argv1) {
    return false;
  }

  return moduleUrl === pathToFileURL(resolve(cwd, argv1)).href;
}

function stdinHasData() {
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile();
  } catch {
    return false;
  }
}

export function parseRunArguments(args) {
  const result = {
    prompt: undefined,
    agent: undefined,
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '--agent') {
      result.agent = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--model') {
      result.modelTier = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--dry-run') {
      result.dryRun = true;
      continue;
    }

    if (current === '--session') {
      result.session = args[index + 1];
      index += 1;
      continue;
    }

    if (result.prompt === undefined) {
      result.prompt = current;
    }
  }

  return result;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trimEnd();
}

export async function main(argv, deps = {}) {
  const [command, ...args] = argv;
  const exit = deps.exit ?? process.exit;
  const stdoutWrite = deps.stdoutWrite ?? ((chunk) => process.stdout.write(chunk));

  if (command === 'models') {
    const modelsLib = await import('./lib/models.mjs');

    if (args.includes('--list')) {
      const result = await (deps.listModels ?? modelsLib.listModels)();
      stdoutWrite(`${JSON.stringify(result)}\n`);
      exit(0);
      return 0;
    }

    if (args.includes('--set')) {
      try {
        const config = JSON.parse(await readStdin());
        const result = (deps.setModels ?? modelsLib.setModels)(config);
        const code = result.success ? 0 : 1;
        stdoutWrite(`${JSON.stringify(result)}\n`);
        exit(code);
        return code;
      } catch (error) {
        const result = {
          type: 'done',
          success: false,
          error: `Invalid JSON: ${error.message}`,
        };
        stdoutWrite(`${JSON.stringify(result)}\n`);
        exit(1);
        return 1;
      }
    }

    if (args.includes('--get')) {
      const getIndex = args.indexOf('--get');
      const candidate = args[getIndex + 1];
      const adaptor = ['opencode', 'cursor', 'omp', 'codex', 'both'].includes(candidate) ? candidate : undefined;
      const result = (deps.getModels ?? modelsLib.getModels)(adaptor);
      stdoutWrite(`${JSON.stringify(result)}\n`);
      exit(0);
      return 0;
    }

    if (args.includes('--reset')) {
      const resetIndex = args.indexOf('--reset');
      const candidate = args[resetIndex + 1];
      const adaptor = ['opencode', 'cursor', 'omp', 'codex', 'both'].includes(candidate) ? candidate : undefined;
      const result = (deps.resetModels ?? modelsLib.resetModels)(adaptor);
      const code = result.success ? 0 : 1;
      stdoutWrite(`${JSON.stringify(result)}\n`);
      exit(code);
      return code;
    }

    throw new Error('Unsupported models subcommand');
  }

  if (command !== 'run') {
    throw new Error(`Unsupported subcommand: ${command}`);
  }

  const parsed = parseRunArguments(args);

  const runCompanionFn = deps.runCompanion
    ?? (deps.runOpencode
      ? (_agentType, prompt, options) => deps.runOpencode(prompt, options)
      : defaultRunCompanion);
  let prompt = parsed.prompt;
  const hasStdinData = deps.stdinHasData ?? stdinHasData;
  if (prompt === undefined && hasStdinData()) {
    prompt = await readStdin();
  }

  const result = await runCompanionFn(parsed.agent ?? 'opencode', prompt, {
    agent: parsed.agent,
    modelTier: parsed.modelTier,
    dryRun: parsed.dryRun,
    session: parsed.session,
  });
  const code = result.success ? 0 : 1;

  exit(code);

  return code;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main(process.argv.slice(2));
}
