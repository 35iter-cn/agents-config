import { readFileSync } from 'node:fs';
import { runCompanion as defaultRunCompanion } from './runner.mjs';

export function parseRunArguments(args) {
  const result = {
    promptPath: undefined,
    companion: undefined,
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '--companion') {
      result.companion = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--modelTier') {
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

    if (current === '--prompt-path') {
      result.promptPath = args[index + 1];
      index += 1;
      continue;
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

  const HELP_TEXT = `Usage: companion <command> [options]

Commands:
  launch                 Launch a companion agent to process the prompt
  models                 Manage model configurations

Launch options:
  --prompt-path <path>   Path to the prompt file (required)
  --companion <name>     Companion type (opencode, cursor, omp, codex)
  --modelTier <tier>     Model tier (low, medium, high, maximum)
  --session <id>         Resume an existing session
  --dry-run              Show what would run without executing

Models options:
  --list                 List configured and available models
  --get [adaptor]        Get model configuration
  --set                  Set model configuration (reads JSON from stdin)
  --reset [adaptor]      Reset model configuration to defaults
`;

  if (argv.includes('--help') || argv.includes('-h')) {
    stdoutWrite(HELP_TEXT);
    exit(0);
    return 0;
  }

  if (command === 'models') {
    const modelsLib = await import('./models.mjs');

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

  if (command !== 'launch') {
    throw new Error(`Unsupported subcommand: ${command}`);
  }

  const parsed = parseRunArguments(args);

  const readPromptFile = deps.readPromptFile
    ?? ((path) => readFileSync(path, 'utf-8').trimEnd());

  if (!parsed.promptPath) {
    stdoutWrite('Error: --prompt-path is required\n');
    exit(1);
    return 1;
  }

  let prompt;
  try {
    prompt = readPromptFile(parsed.promptPath);
  } catch (error) {
    stdoutWrite(`Error: cannot read prompt file: ${error.message}\n`);
    exit(1);
    return 1;
  }

  const runCompanionFn = deps.runCompanion
    ?? (deps.runOpencode
      ? (_agentType, prompt, options) => deps.runOpencode(prompt, options)
      : defaultRunCompanion);

  const result = await runCompanionFn(parsed.companion ?? 'opencode', prompt, {
    companion: parsed.companion,
    modelTier: parsed.modelTier,
    dryRun: parsed.dryRun,
    session: parsed.session,
  });
  const code = result.success ? 0 : 1;

  exit(code);

  return code;
}
