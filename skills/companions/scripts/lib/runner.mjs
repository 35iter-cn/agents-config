import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createOpencodeAdaptor } from './adaptors/opencode.mjs';
import { createOmpAdaptor } from './adaptors/omp.mjs';
import { createCursorAdaptor } from './adaptors/cursor.mjs';
import { createCodexAdaptor } from './adaptors/codex.mjs';
import { cleanupAgentshubLogs } from './cleanup.mjs';

const HEARTBEAT_INTERVAL_MS = 300000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 2000;
const TIER_FALLBACK = ['maximum', 'high', 'medium', 'low'];

function createHeartbeat(durationMs) {
  return JSON.stringify({
    type: 'heartbeat',
    durationMs,
    message: 'still running',
  });
}

function createStartedNotification(agent, model) {
  return JSON.stringify({
    type: 'started',
    message: `agent: ${agent} model: ${model}`,
  });
}

function createRetryNotification({ attempt, model, errorClass, message }) {
  return JSON.stringify({
    type: 'retry',
    attempt,
    model,
    errorClass,
    message,
  });
}

function createDoneMarker(result, summary, summaryPath) {
  return JSON.stringify({
    type: 'done',
    success: result.success,
    exitCode: result.exitCode,
    durationMs: summary.durationMs,
    summaryPath,
  });
}

const AGENTS = {
  opencode: {
    command: 'opencode',
    buildArgs: (options) => {
      const args = ['run', '--format', 'json'];
      if (options.modelId) {
        args.push('--model', options.modelId);
      }
      if (options.session) {
        args.push('--session', options.session);
      }
      if (options.companion === 'opencode') {
        return args;
      }
      if (options.companion && options.companion !== 'cursor') {
        args.push('--agent', String(options.companion));
      }
      return args;
    },
    createAdaptor: createOpencodeAdaptor,
  },
  cursor: {
    command: 'agent',
    buildArgs: (options) => {
      const args = ['--print', '--output-format', 'stream-json', '--trust', '--force'];
      if (options.modelId) {
        args.push('--model', options.modelId);
      }
      if (options.session) {
        args.push('--resume', options.session);
      }
      return args;
    },
    createAdaptor: createCursorAdaptor,
  },
  omp: {
    command: 'omp',
    buildArgs: (options) => {
      const args = ['-p', '--mode', 'json'];
      if (options.modelId) {
        args.push('--model', options.modelId);
      }
      if (options.session) {
        args.push('--resume', options.session);
      }
      return args;
    },
    createAdaptor: createOmpAdaptor,
    useStdin: false,
  },
  codex: {
    command: 'codex',
    buildArgs: (options) => {
      const base = ['--json', '--dangerously-bypass-approvals-and-sandbox'];
      if (options.modelId) {
        base.push('-m', options.modelId);
      }
      if (options.session) {
        return ['exec', 'resume', ...base, options.session];
      }
      return ['exec', ...base];
    },
    createAdaptor: createCodexAdaptor,
    useStdin: true,
  },
};
function pickRetryPlan({ modelError, currentTier, attemptNumber, backoffMs }) {
  if (!modelError) {
    return null;
  }
  if (attemptNumber > MAX_RETRIES) {
    return null;
  }
  const klass = modelError.class;
  if (klass === 'auth_error' || klass === 'unknown' || klass === 'tool_error' || klass === 'process_error') {
    return null;
  }
  if (klass === 'network_error' || klass === 'rate_limited') {
    return {
      tier: currentTier,
      backoffMs: backoffMs ?? RETRY_BACKOFF_MS,
      errorClass: klass,
      message:
        klass === 'rate_limited'
          ? 'Rate limited; retrying same model after backoff.'
          : 'Network error; retrying same model after backoff.',
    };
  }
  if (klass === 'model_unavailable') {
    if (!currentTier) {
      return null;
    }
    const idx = TIER_FALLBACK.indexOf(currentTier);
    if (idx === -1 || idx === TIER_FALLBACK.length - 1) {
      return null;
    }
    const nextTier = TIER_FALLBACK[idx + 1];
    return {
      tier: nextTier,
      backoffMs: 0,
      errorClass: klass,
      message: `Model unavailable; retrying with lower tier '${nextTier}'.`,
    };
  }
  return null;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSingleAttempt(config, agentType, prompt, options) {
  const adaptor = config.createAdaptor();
  const modelId = (options.resolveModel ?? ((tier) => adaptor.resolveModel(tier)))(options.modelTier);
  const startTime = Date.now();
  const cwd = process.cwd();
  const spawnImpl = options.spawnImpl ?? spawn;
  const hardTimeoutMs = options.hardTimeoutMs ?? 14400000;
  const dryRun = options.dryRun ?? false;
  const useStdin = config.useStdin ?? options.stdin ?? true;
  const args = config.buildArgs({ ...options, modelId });
  const logDir = '/tmp/companions';
  mkdirSync(logDir, { recursive: true });
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('-');
  const logPath = options.logPath ?? `${logDir}/raw-${timestamp}-${randomUUID().slice(0, 8)}.jsonl`;
  const writeLine = options.writeLine ?? ((line) => process.stdout.write(line + '\n'));

  if (!useStdin && prompt !== undefined) {
    args.push(String(prompt));
  }

  if (dryRun) {
    const command = [config.command, ...args].join(' ');
    writeLine(command);
    const summary = adaptor.getSummary();
    summary.success = true;
    summary.exitCode = 0;
    summary.durationMs = Date.now() - startTime;
    summary.commandsExecuted.push({ command, status: 'completed' });
    summary.logPath = logPath;
    if (options.session) {
      summary.sessionID = options.session;
    }
    return Promise.resolve({
      result: { success: true, exitCode: 0 },
      summary,
      modelId,
      modelError: null,
      heartbeatsEmitted: 0,
    });
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  return new Promise((resolve) => {
    let stderr = '';
    let finished = false;
    let buffer = '';
    let heartbeatTimeout = null;
    let hasOutputSinceLastHeartbeat = false;
    let terminationReason = null;
    let heartbeatsEmitted = 0;

    writeFileSync(logPath, '');

    const emit = writeLine;

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;

      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
      if (hardTimeout) {
        clearTimeout(hardTimeout);
        hardTimeout = null;
      }

      if (terminationReason) {
        result.success = false;
        if (terminationReason === 'stuck') {
          result.exitCode = null;
        }
      }

      const summary = adaptor.getSummary();
      summary.success = result.success;
      summary.exitCode = result.exitCode;
      summary.durationMs = Date.now() - startTime;
      summary.logPath = logPath;

      if (result.sessionID !== undefined) {
        summary.sessionID = result.sessionID;
      }

      if (options.session && typeof adaptor.validateSession === 'function') {
        const sessionError = adaptor.validateSession(stderr, options.session, summary.sessionID);
        if (sessionError) {
          result.success = false;
          summary.success = false;
          summary.sessionError = sessionError;
        }
      }

      if (stderr) {
        summary.stderr = stderr;
      }

      // Classify stderr-based model errors (cursor) if no model error already
      // detected via JSON stream.
      if (summary.modelErrors.length === 0 && stderr && typeof adaptor.classifyStderr === 'function') {
        adaptor.classifyStderr(stderr);
      }

      // Derive a model-level error indicator. Prefer modelErrors[] populated by
      // the adaptor; otherwise synthesize for termination reasons such as
      // stuck/timeout (no output = likely network hang).
      let modelError = summary.modelErrors[summary.modelErrors.length - 1] ?? null;
      if (!modelError && (terminationReason === 'stuck' || terminationReason === 'timeout')) {
        // Treat hangs with no produced output as transient network errors;
        // hangs after producing work are NOT classified here so retry logic
        // declines them via the no-files/no-commands guard.
        if (summary.filesModified.length === 0 && summary.commandsExecuted.length === 0) {
          modelError = {
            class: 'network_error',
            name: 'ProcessHang',
            message: `Companion process ${terminationReason} with no output`,
          };
          summary.modelErrors.push(modelError);
        }
      }
      // Process-spawn errors (ENOENT etc.) are non-retryable
      if (!modelError && result.processError) {
        modelError = {
          class: 'process_error',
          name: result.processError.code || 'SpawnError',
          message: result.processError.message,
        };
        summary.modelErrors.push(modelError);
      }

      resolve({
        result,
        summary,
        modelId,
        modelError,
        emit,
        heartbeatsEmitted,
      });
    };

    const child = spawnImpl(config.command, args, {
      cwd,
      stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    if (useStdin && prompt !== undefined) {
      child.stdin.write(String(prompt));
      child.stdin.end();
    }

    let hardTimeout = null;
    if (hardTimeoutMs > 0) {
      hardTimeout = setTimeout(() => {
        terminationReason = 'timeout';
        const summary = adaptor.getSummary();
        summary.errors.push({
          tool: agentType,
          callID: null,
          error: `Hard timeout exceeded after ${hardTimeoutMs}ms`,
          context: { command: config.command, reason: 'timeout' },
        });
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      }, hardTimeoutMs);
    }

    const scheduleHeartbeat = () => {
      if (finished) {
        return;
      }
      if (!hasOutputSinceLastHeartbeat) {
        terminationReason = 'stuck';
        const summary = adaptor.getSummary();
        summary.errors.push({
          tool: agentType,
          callID: null,
          error: 'Companion process stuck — no output for heartbeat interval',
          context: { command: config.command, reason: 'stuck' },
        });
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
        return;
      }
      hasOutputSinceLastHeartbeat = false;
      heartbeatsEmitted += 1;
      emit(createHeartbeat(Date.now() - startTime));
      heartbeatTimeout = setTimeout(scheduleHeartbeat, heartbeatIntervalMs);
    };

    heartbeatTimeout = setTimeout(scheduleHeartbeat, heartbeatIntervalMs);

    child.stdout.on('data', (chunk) => {
      hasOutputSinceLastHeartbeat = true;
      const text = chunk.toString();
      appendFileSync(logPath, text);

      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const event = JSON.parse(line);
          adaptor.push(event);
        } catch {
          // Ignore non-JSON lines in minimal runner mode.
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      hasOutputSinceLastHeartbeat = true;
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      const summary = adaptor.getSummary();
      summary.errors.push({
        tool: agentType,
        callID: null,
        error: error.code === 'ENOENT' ? 'command_not_found' : error.message,
        context: { command: config.command },
      });
      stderr += error.message;
      finish({ success: false, exitCode: null, processError: error });
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          adaptor.push(JSON.parse(buffer));
        } catch {
          // Ignore trailing non-JSON output in minimal runner mode.
        }
      }
      finish({ success: code === 0, exitCode: code });
    });
  });
}

export function runCompanion(agentType, prompt, options = {}) {
  // 启动前自动清理旧日志
  cleanupAgentshubLogs().catch((err) => {
    console.error('[companions] log cleanup failed:', err.message);
  });

  const config = AGENTS[agentType];
  if (!config) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const dryRun = options.dryRun ?? false;
  const initialTier = options.modelTier;
  const overallStart = Date.now();
  const writeLine = options.writeLine ?? ((line) => process.stdout.write(line + '\n'));

  // Emit started exactly once before the first attempt (dryRun path also
  // historically skipped started; preserve that to keep existing tests intact).
  const tempAdaptor = config.createAdaptor();
  const initialModelId = (options.resolveModel ?? ((tier) => tempAdaptor.resolveModel(tier)))(initialTier);

  if (!dryRun) {
    writeLine(createStartedNotification(agentType, initialModelId ?? 'auto'));
  }

  const attempts = [];

  const runLoop = async () => {
    let currentTier = initialTier;
    let attemptIndex = 0;
    let lastOutcome = null;

    while (true) {
      attemptIndex += 1;
      const attemptOptions = { ...options, modelTier: currentTier, writeLine };
      const outcome = await runSingleAttempt(config, agentType, prompt, attemptOptions);
      lastOutcome = outcome;

      attempts.push({
        modelTier: currentTier ?? null,
        modelId: outcome.modelId ?? null,
        success: outcome.result.success,
        errorClass: outcome.modelError?.class ?? null,
      });

      if (outcome.result.success) {
        break;
      }

      // Guard: don't retry if any side effects were produced.
      if (outcome.summary.filesModified.length > 0 || outcome.summary.commandsExecuted.length > 0) {
        break;
      }

      const plan = pickRetryPlan({
        modelError: outcome.modelError,
        currentTier,
        attemptNumber: attemptIndex,
        backoffMs: options.retryBackoffMs,
      });
      if (!plan) {
        break;
      }

      const nextModelId = (options.resolveModel ?? ((tier) => config.createAdaptor().resolveModel(tier)))(plan.tier);
      writeLine(
        createRetryNotification({
          attempt: attemptIndex,
          model: nextModelId ?? plan.tier ?? 'auto',
          errorClass: plan.errorClass,
          message: plan.message,
        }),
      );

      if (plan.backoffMs > 0) {
        await sleep(plan.backoffMs);
      }
      currentTier = plan.tier;
    }

    return lastOutcome;
  };

  return runLoop().then((outcome) => {
    const summary = outcome.summary;
    summary.attempts = attempts;
    summary.retryCount = Math.max(0, attempts.length - 1);
    summary.finalModelTier = attempts[attempts.length - 1]?.modelTier ?? null;
    summary.durationMs = Date.now() - overallStart;
    summary.heartbeatsEmitted = outcome.heartbeatsEmitted ?? 0;

    const logDir = '/tmp/companions';
    const sessionName = options.sessionName ?? 'unknown';
    const summaryPath = `${logDir}/summary-${sessionName}.jsonl`;
    writeFileSync(summaryPath, JSON.stringify(summary) + '\n');

    writeLine(createDoneMarker(outcome.result, summary, summaryPath));
    return summary;
  });
}

export function runOpencode(prompt, options = {}) {
  return runCompanion('opencode', prompt, {
    ...options,
    stdin: options.stdin ?? false,
  });
}

export function createSummaryCollector() {
  const adaptor = createOpencodeAdaptor();
  return {
    get summary() {
      return adaptor.getSummary();
    },
    push(event) {
      adaptor.push(event);
    },
  };
}
