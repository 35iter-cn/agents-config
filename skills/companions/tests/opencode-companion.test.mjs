import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  main,
  parseRunArguments,
} from '../scripts/lib/companion.mjs';

test('parseRunArguments keeps prompt and parses companion flag', () => {
  const result = parseRunArguments([
    'ship this prompt exactly',
    '--companion',
    'reviewer',
  ]);

  assert.deepEqual(result, {
    prompt: 'ship this prompt exactly',
    companion: 'reviewer',
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments parses all supported --modelTier tiers', () => {
  assert.deepEqual(parseRunArguments(['task', '--modelTier', 'low']), {
    prompt: 'task',
    companion: undefined,
    modelTier: 'low',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--modelTier', 'medium']), {
    prompt: 'task',
    companion: undefined,
    modelTier: 'medium',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--modelTier', 'high']), {
    prompt: 'task',
    companion: undefined,
    modelTier: 'high',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--modelTier', 'maximum']), {
    prompt: 'task',
    companion: undefined,
    modelTier: 'maximum',
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments leaves modelTier undefined when --modelTier is omitted', () => {
  const result = parseRunArguments(['task only']);
  assert.equal(result.modelTier, undefined);
});

test('main dispatches run subcommand and exits zero on success', async () => {
  const exits = [];
  const calls = [];
  const result = {
    success: true,
    exitCode: 0,
    finalMessage: 'done',
  };

  const code = await main(
    ['run', 'do work', '--companion', 'plan'],
    {
      runOpencode: async (prompt, options) => {
        calls.push({ prompt, options });
        return result;
      },
      exit(code) {
        exits.push(code);
      },
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


test('main exits non-zero when runOpencode fails', async () => {
  const exits = [];
  const result = {
    success: false,
    exitCode: 2,
    errors: [{ tool: 'bash', error: 'failed' }],
  };

  const code = await main(['run', 'demo prompt'], {
    runOpencode: async () => result,
    exit(value) {
      exits.push(value);
    },
  });

  assert.deepEqual(exits, [1]);
  assert.equal(code, 1);
});

test('parseRunArguments parses --dry-run flag', () => {
  const result = parseRunArguments(['ship this prompt exactly', '--dry-run']);

  assert.deepEqual(result, {
    prompt: 'ship this prompt exactly',
    companion: undefined,
    modelTier: undefined,
    dryRun: true,
    session: undefined,
  });
});

test('main passes dryRun to runOpencode when --dry-run flag is set', async () => {
  const calls = [];
  const exits = [];

  const code = await main(['run', 'do work', '--dry-run'], {
    runOpencode: async (prompt, options) => {
      calls.push({ prompt, options });
      return { success: true };
    },
    exit: (c) => exits.push(c),
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'do work');
  assert.equal(calls[0].options.dryRun, true);
});

test('main reads prompt from stdin when no positional arg and stdin has data', async () => {
  const calls = [];
  const exits = [];

  const mockRunOpencode = async (prompt, options) => {
    calls.push({ prompt, options });
    return { success: true };
  };

  const mockStdin = new Readable({
    read() {
      this.push('xx xx');
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
    const code = await main(['run'], {
      runOpencode: mockRunOpencode,
      exit: (c) => exits.push(c),
      stdinHasData: () => true,
    });

    assert.equal(code, 0);
    assert.deepEqual(exits, [0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'xx xx');
    assert.deepEqual(calls[0].options, {
      companion: undefined,
      modelTier: undefined,
      dryRun: false,
      session: undefined,
    });
  } finally {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
      writable: true,
    });
  }
});

test('main passes requested agent type to runCompanion', async () => {
  const calls = [];

  const code = await main(['run', 'do work', '--companion', 'cursor'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
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

  await main(['run', 'do work', '--modelTier', 'high'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
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
    'continue the task',
    '--session',
    'sid-abc-123',
  ]);

  assert.deepEqual(result, {
    prompt: 'continue the task',
    companion: undefined,
    modelTier: undefined,
    dryRun: false,
    session: 'sid-abc-123',
  });
});

test('parseRunArguments parses --session alongside --companion and --modelTier', () => {
  const result = parseRunArguments([
    'do work',
    '--companion', 'cursor',
    '--modelTier', 'high',
    '--session', 'sid-xyz',
  ]);

  assert.deepEqual(result, {
    prompt: 'do work',
    companion: 'cursor',
    modelTier: 'high',
    dryRun: false,
    session: 'sid-xyz',
  });
});

test('main passes session option to runCompanion', async () => {
  const calls = [];
  const code = await main(['run', 'resume task', '--session', 'sid-123'], {
    runCompanion: async (agentType, prompt, options) => {
      calls.push({ agentType, prompt, options });
      return { success: true };
    },
    exit() {},
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
  assert.match(output, /run \[prompt\]/);
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
});

test('main prints help for run --help', async () => {
  const writes = [];
  const exits = [];

  const code = await main(['run', '--help'], {
    stdoutWrite: (chunk) => writes.push(chunk),
    exit: (value) => exits.push(value),
  });

  assert.equal(code, 0);
  assert.deepEqual(exits, [0]);
  const output = writes.join('');
  assert.match(output, /Usage:/);
});
