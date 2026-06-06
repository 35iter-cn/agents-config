import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  main,
  parseRunArguments,
} from '../scripts/lib/companion.mjs';

test('parseRunArguments parses --prompt-path and companion flag', () => {
  const result = parseRunArguments([
    '--prompt-path',
    '/tmp/prompt.txt',
    '--companion',
    'reviewer',
  ]);

  assert.deepEqual(result, {
    promptPath: '/tmp/prompt.txt',
    companion: 'reviewer',
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments parses all supported --modelTier tiers', () => {
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'low']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'low',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'medium']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'medium',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'high']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'high',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['--prompt-path', 'p.txt', '--modelTier', 'maximum']), {
    promptPath: 'p.txt',
    companion: undefined,
    modelTier: 'maximum',
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments leaves modelTier undefined when --modelTier is omitted', () => {
  const result = parseRunArguments(['--prompt-path', 'task.txt']);
  assert.equal(result.modelTier, undefined);
  assert.equal(result.promptPath, 'task.txt');
});

test('main dispatches launch subcommand and exits zero on success', async () => {
  const exits = [];
  const calls = [];
  const result = {
    success: true,
    exitCode: 0,
    finalMessage: 'done',
  };

  const code = await main(
    ['launch', '--prompt-path', 'prompt.txt', '--companion', 'plan'],
    {
      runOpencode: async (prompt, options) => {
        calls.push({ prompt, options });
        return result;
      },
      exit(code) {
        exits.push(code);
      },
      readPromptFile: () => 'do work',
    },
  );

  assert.deepEqual(calls, [
    {
      prompt: 'do work',
      options: {
        companion: 'plan',
        modelTier: undefined,
        dryRun: false,
        session: undefined,
      },
    },
  ]);
  assert.deepEqual(exits, [0]);
  assert.equal(code, 0);
});


test('main exits non-zero when launch fails', async () => {
  const exits = [];
  const result = {
    success: false,
    exitCode: 2,
    errors: [{ tool: 'bash', error: 'failed' }],
  };

  const code = await main(['launch', '--prompt-path', 'demo.txt'], {
    runOpencode: async () => result,
    exit(value) {
      exits.push(value);
    },
    readPromptFile: () => 'demo prompt',
  });

  assert.deepEqual(exits, [1]);
  assert.equal(code, 1);
});

test('parseRunArguments parses --dry-run flag', () => {
  const result = parseRunArguments(['--prompt-path', 'ship.txt', '--dry-run']);

  assert.deepEqual(result, {
    promptPath: 'ship.txt',
    companion: undefined,
    modelTier: undefined,
    dryRun: true,
    session: undefined,
  });
});

test('main passes dryRun to runOpencode when --dry-run flag is set', async () => {
  const calls = [];
  const exits = [];

  const code = await main(['launch', '--prompt-path', 'work.txt', '--dry-run'], {
    runOpencode: async (prompt, options) => {
      calls.push({ prompt, options });
      return { success: true };
    },
    exit: (c) => exits.push(c),
    readPromptFile: () => 'do work',
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'do work');
  assert.equal(calls[0].options.dryRun, true);
});

test('main passes requested agent type to runCompanion', async () => {
  const calls = [];

  const code = await main(['launch', '--prompt-path', 'work.txt', '--companion', 'cursor'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
    readPromptFile: () => 'do work',
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    {
      agentType: 'cursor',
      prompt: 'do work',
      options: {
        companion: 'cursor',
        modelTier: undefined,
        dryRun: false,
        session: undefined,
      },
    },
  ]);
});

test('main passes modelTier to runCompanion when --model is set', async () => {
  const calls = [];

  await main(['launch', '--prompt-path', 'work.txt', '--modelTier', 'high'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
    readPromptFile: () => 'do work',
  });

  assert.deepEqual(calls, [
    {
      agentType: 'opencode',
      prompt: 'do work',
      options: {
        companion: undefined,
        modelTier: 'high',
        dryRun: false,
        session: undefined,
      },
    },
  ]);
});

test('main dispatches models --list and writes JSON result', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['models', '--list'], {
    listModels: async () => ({
      configured: { opencode: {}, cursor: {} },
      available: { opencode: ['a/model'], cursor: [] },
    }),
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(writes, [
    `${JSON.stringify({
      configured: { opencode: {}, cursor: {} },
      available: { opencode: ['a/model'], cursor: [] },
    })}\n`,
  ]);
});

test('main dispatches models --set with parsed stdin JSON', async () => {
  const writes = [];
  const exits = [];
  const calls = [];

  const mockStdin = new Readable({
    read() {
      this.push('{"opencode":{"low":"x/model"}}');
      this.push(null);
    },
  });

  const originalStdin = process.stdin;
  Object.defineProperty(process, 'stdin', {
    value: mockStdin,
    configurable: true,
    writable: true,
  });

  try {
    const code = await main(['models', '--set'], {
      setModels: (config) => {
        calls.push(config);
        return { type: 'done', success: true };
      },
      stdoutWrite: (chunk) => writes.push(chunk),
      exit: (value) => exits.push(value),
    });

    assert.equal(code, 0);
    assert.deepEqual(calls, [{ opencode: { low: 'x/model' } }]);
    assert.deepEqual(writes, ['{"type":"done","success":true}\n']);
    assert.deepEqual(exits, [0]);
  } finally {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
      writable: true,
    });
  }
});

test('main returns failure marker for invalid models --set JSON', async () => {
  const writes = [];
  const exits = [];

  const mockStdin = new Readable({
    read() {
      this.push('{oops');
      this.push(null);
    },
  });

  const originalStdin = process.stdin;
  Object.defineProperty(process, 'stdin', {
    value: mockStdin,
    configurable: true,
    writable: true,
  });

  try {
    const code = await main(['models', '--set'], {
      stdoutWrite: (chunk) => writes.push(chunk),
      exit: (value) => exits.push(value),
    });

    assert.equal(code, 1);
    assert.deepEqual(exits, [1]);
    assert.equal(writes.length, 1);
    assert.match(writes[0], /"success":false/);
    assert.match(writes[0], /Invalid JSON/);
  } finally {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
      writable: true,
    });
  }
});

test('parseRunArguments parses --session flag', () => {
  const result = parseRunArguments([
    '--prompt-path',
    'continue.txt',
    '--session',
    'sid-abc-123',
  ]);

  assert.deepEqual(result, {
    promptPath: 'continue.txt',
    companion: undefined,
    modelTier: undefined,
    dryRun: false,
    session: 'sid-abc-123',
  });
});

test('parseRunArguments parses --session alongside --companion and --modelTier', () => {
  const result = parseRunArguments([
    '--prompt-path',
    'do-work.txt',
    '--companion', 'cursor',
    '--modelTier', 'high',
    '--session', 'sid-xyz',
  ]);

  assert.deepEqual(result, {
    promptPath: 'do-work.txt',
    companion: 'cursor',
    modelTier: 'high',
    dryRun: false,
    session: 'sid-xyz',
  });
});

test('main passes session option to runCompanion', async () => {
  const calls = [];
  const code = await main(['launch', '--prompt-path', 'task.txt', '--session', 'sid-123'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
    readPromptFile: () => 'resume task',
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{
    agentType: 'opencode',
    prompt: 'resume task',
    options: {
      companion: undefined,
      modelTier: undefined,
      dryRun: false,
      session: 'sid-123',
    },
  }]);
});

test('main dispatches models --get and writes config JSON', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['models', '--get', 'opencode'], {
    getModels: () => ({ opencode: { low: 'a' }, cursor: {} }),
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(writes, [`${JSON.stringify({ opencode: { low: 'a' }, cursor: {} })}\n`]);
});

test('main dispatches models --get without adaptor and writes full config', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['models', '--get'], {
    getModels: () => ({ opencode: { low: 'a' }, cursor: { low: 'b' } }),
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(writes, [`${JSON.stringify({ opencode: { low: 'a' }, cursor: { low: 'b' } })}\n`]);
});

test('main dispatches models --reset and exits zero on success', async () => {
  const writes = [];
  const exits = [];
  const calls = [];

  const code = await main(['models', '--reset', 'opencode'], {
    resetModels: (adaptor) => {
      calls.push(adaptor);
      return { type: 'done', success: true };
    },
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(calls, ['opencode']);
  assert.deepEqual(writes, ['{"type":"done","success":true}\n']);
});

test('main dispatches models --reset and exits non-zero on failure', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['models', '--reset', 'invalid'], {
    resetModels: () => ({ type: 'done', success: false, error: 'bad adaptor' }),
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 1);
  assert.deepEqual(exits, [1]);
  assert.match(writes[0], /"success":false/);
});

test('main prints help and exits zero for --help', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['--help'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  const output = writes.join('');
  assert.match(output, /Usage:/);
  assert.match(output, /launch/);
  assert.match(output, /--prompt-path/);
  assert.match(output, /--companion/);
  assert.match(output, /--modelTier/);
});

test('main prints help for -h', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['-h'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  const output = writes.join('');
  assert.match(output, /Usage:/);
  assert.match(output, /launch/);
});

test('main prints help for launch --help', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['launch', '--help'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  const output = writes.join('');
  assert.match(output, /Usage:/);
  assert.match(output, /launch/);
});

test('main reads prompt from file when --prompt-path is provided', async () => {
  const calls = [];
  const exits = [];

  const code = await main(
    ['launch', '--prompt-path', 'my-prompt.txt'],
    {
      runCompanion: async (agentType, prompt, options) => {
        calls.push({ agentType, prompt, options });
        return { success: true };
      },
      exit: (value) => exits.push(value),
      readPromptFile: () => 'file contents here',
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'file contents here');
  assert.equal(calls[0].agentType, 'opencode');
});

test('main requires --prompt-path and exits non-zero when missing', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['launch'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 1);
  assert.deepEqual(exits, [1]);
  assert.match(writes.join(''), /--prompt-path is required/);
});

test('main exits non-zero when prompt file does not exist', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['launch', '--prompt-path', '/nonexistent/prompt.txt'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 1);
  assert.deepEqual(exits, [1]);
  const output = writes.join('');
  assert.match(output, /cannot read prompt file/);
  assert.match(output, /ENOENT/);
});
