import { createBaseSummary } from '../summary.mjs';
import { resolveModel } from '../models.mjs';

const MODEL_NOT_FOUND_PATTERNS = [
  /Model not found/i,
  /model.*not.*found/i,
];

function classifyOpencodeErrorEvent(event) {
  const errorName = event.error?.name;
  const errorData = event.error?.data || {};

  if (errorName === 'APIError') {
    const statusCode = errorData.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return {
        class: 'auth_error',
        name: errorName,
        message: errorData.message,
        statusCode,
        isRetryable: errorData.isRetryable,
      };
    }
    if (statusCode === 429) {
      return {
        class: 'rate_limited',
        name: errorName,
        message: errorData.message,
        statusCode,
        isRetryable: errorData.isRetryable,
      };
    }
    if (typeof statusCode === 'number' && statusCode >= 500) {
      return {
        class: 'network_error',
        name: errorName,
        message: errorData.message,
        statusCode,
      };
    }
    if (errorData.isRetryable === false) {
      return {
        class: 'auth_error',
        name: errorName,
        message: errorData.message,
        statusCode,
        isRetryable: false,
      };
    }
  }

  const message = errorData.message || '';
  const isModelNotFound = errorData.code === 'model_not_found'
    || MODEL_NOT_FOUND_PATTERNS.some((p) => p.test(message));
  if (isModelNotFound) {
    return {
      class: 'model_unavailable',
      name: errorName || 'UnknownError',
      message,
    };
  }

  return {
    class: 'unknown',
    name: errorName || 'UnknownError',
    message,
  };
}

export function createOpencodeAdaptor() {
  const summary = createBaseSummary();

  return {
    push(event) {
      if (!event || typeof event !== 'object') {
        return;
      }

      if (event.sessionID !== undefined && summary.sessionID === undefined) {
        summary.sessionID = event.sessionID;
      }

      if (event.type === 'error' && event.error) {
        summary.modelErrors.push(classifyOpencodeErrorEvent(event));
        return;
      }

      const part = event.part;
      if (!part || typeof part !== 'object') {
        return;
      }

      if (event.type === 'tool_use' && part.type === 'tool') {
        const state = part.state && typeof part.state === 'object' ? part.state : {};
        const input = state.input && typeof state.input === 'object' ? state.input : {};
        const status = typeof state.status === 'string' ? state.status : undefined;

        if (part.tool === 'bash' && (status === 'completed' || status === 'error')) {
          const command = { command: input.command ?? '', status };
          if (state.output !== undefined) {
            command.output = state.output;
          }
          summary.commandsExecuted.push(command);
        }

        if (status === 'error') {
          summary.errors.push({
            tool: part.tool ?? 'unknown',
            callID: part.callID ?? null,
            error: state.error ?? 'unknown_error',
            context: Object.keys(input).length > 0 ? input : undefined,
          });
          return;
        }

        if (status !== 'completed') {
          return;
        }

        if (part.tool === 'read') {
          summary.filesRead.push({ path: input.filePath ?? null, status });
        }

        if (part.tool === 'edit' || part.tool === 'write') {
          summary.filesModified.push({ path: input.filePath ?? null, operation: part.tool });
        }

        return;
      }

      if (event.type === 'text' && typeof part.text === 'string') {
        const msgID = part.messageID;
        if (msgID && msgID !== summary._currentMessageID) {
          summary._currentMessageID = msgID;
          summary.finalMessage = part.text;
        } else {
          summary.finalMessage += part.text;
        }
        return;
      }

      if (event.type === 'step_finish' && part.tokens && typeof part.tokens === 'object') {
        const usage = part.tokens;
        const cache = usage.cache && typeof usage.cache === 'object' ? usage.cache : {};
        summary.tokenUsage = {
          input: Number(usage.input) || 0,
          output: Number(usage.output) || 0,
          total: Number(usage.total) || 0,
          reasoning: Number(usage.reasoning) || 0,
          cache: {
            write: Number(cache.write) || 0,
            read: Number(cache.read) || 0,
          },
        };
      }
    },
    getSummary() {
      return summary;
    },
    resolveModel(tier) {
      return resolveModel('opencode', tier);
    },
    classifyStderr() {
      return null;
    },
    validateSession(stderr, expectedSessionId, returnedSessionId) {
      if (typeof stderr === 'string' && stderr.includes('Session not found')) {
        return { type: 'not_found', message: 'Session not found' };
      }
      if (returnedSessionId && returnedSessionId !== expectedSessionId) {
        return { type: 'mismatch', expected: expectedSessionId, actual: returnedSessionId };
      }
      if (!returnedSessionId) {
        return { type: 'missing', message: 'No sessionID returned during resumption' };
      }
      return null;
    },
  };
}
