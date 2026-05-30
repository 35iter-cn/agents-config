import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  main,
  parseRunArguments,
} from '../scripts/lib/companion.mjs';

test('parseRunArguments keeps prompt and parses agent flag', () => {
  const result = parseRunArguments([
    'ship this prompt exactly',
    '--agent',
    'reviewer',
  ]);

  assert.deepEqual(result, {
    prompt: 'ship this prompt exactly',
    agent: 'reviewer',
    modelTier: undefined,
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments parses all supported --model tiers', () => {
  assert.deepEqual(parseRunArguments(['task', '--model', 'low']), {
    prompt: 'task',
    agent: undefined,
    modelTier: 'low',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--model', 'medium']), {
    prompt: 'task',
    agent: undefined,
    modelTier: 'medium',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--model', 'high']), {
    prompt: 'task',
    agent: undefined,
    modelTier: 'high',
    dryRun: false,
    session: undefined,
  });
  assert.deepEqual(parseRunArguments(['task', '--model', 'maximum']), {
    prompt: 'task',
    agent: undefined,
    modelTier: 'maximum',
    dryRun: false,
    session: undefined,
  });
});

test('parseRunArguments leaves modelTier undefined when --model is omitted', () => {
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
    ['run', 'do work', '--agent', 'plan'],
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
        agent: 'plan',
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
    agent: undefined,
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
      agent: undefined,
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

  const code = await main(['run', 'do work', '--agent', 'cursor'], {
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
        agent: 'cursor',
        modelTier: undefined,
        dryRun: false,
        session: undefined,
      },
    },
  ]);
});

test('main passes modelTier to runCompanion when --model is set', async () => {
  const calls = [];

  await main(['run', 'do work', '--model', 'high'], {
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
        agent: undefined,
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
    agent: undefined,
    modelTier: undefined,
    dryRun: false,
    session: 'sid-abc-123',
  });
});

test('parseRunArguments parses --session alongside --agent and --model', () => {
  const result = parseRunArguments([
    'do work',
    '--agent', 'cursor',
    '--model', 'high',
    '--session', 'sid-xyz',
  ]);

  assert.deepEqual(result, {
    prompt: 'do work',
    agent: 'cursor',
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
      agent: undefined,
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
