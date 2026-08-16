import { createBaseSummary } from '../summary.mjs';
import { resolveModel } from '../models.mjs';

const NETWORK_ERROR_PATTERNS = [
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bEAI_AGAIN\b/,
  /\bunavailable\b/i,
];

const MODEL_UNAVAILABLE_PATTERNS = [
  /Cannot use this model/i,
  /model.*not.*available/i,
  /hit your usage limit/i,
];

const AUTH_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /invalid.*api.*key/i,
  /authentication.*failed/i,
];

export function classifyOmpStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return null;
  }
  if (AUTH_ERROR_PATTERNS.some((p) => p.test(stderr))) {
    return { class: 'auth_error', message: stderr.trim() };
  }
  if (MODEL_UNAVAILABLE_PATTERNS.some((p) => p.test(stderr))) {
    return { class: 'model_unavailable', message: stderr.trim() };
  }
  if (NETWORK_ERROR_PATTERNS.some((p) => p.test(stderr))) {
    return { class: 'network_error', message: stderr.trim() };
  }
  return null;
}

/**
 * Maps the omp JSON event stream into a unified summary.
 *
 * Key event types:
 *   session          — carries session.id
 *   message_end      — role:"assistant" carries final text content + usage
 *   tool_execution_start — announces tool call with args (tracked by toolCallId)
 *   tool_execution_end   — completes tool call with result
 */
export function createOmpAdaptor() {
  const summary = createBaseSummary();
  /** @type {Map<string, {name: string, args: object}>} */
  const pendingToolCalls = new Map();

  return {
    push(event) {
      if (!event || typeof event !== 'object') {
        return;
      }

      // ---- session: capture sessionID ----
      if (event.type === 'session' && typeof event.id === 'string') {
        if (summary.sessionID === undefined) {
          summary.sessionID = event.id;
        }
        return;
      }

      // ---- message_end: final text + token usage ----
      if (event.type === 'message_end') {
        const msg = event.message;
        if (msg && typeof msg === 'object') {
          // Assistant messages carry the final response text
          if (msg.role === 'assistant') {
            const content = Array.isArray(msg.content) ? msg.content : [];
            const texts = content
              .filter((item) => item?.type === 'text' && typeof item.text === 'string')
              .map((item) => item.text);
            if (texts.length > 0) {
              summary.finalMessage = texts.join('');
            }
          }

          // Token usage appears on assistant message_end events
          if (event.usage && typeof event.usage === 'object') {
            const u = event.usage;
            summary.tokenUsage = {
              input: Number(u.input) || 0,
              output: Number(u.output) || 0,
              total: Number(u.totalTokens) || 0,
              reasoning: Number(u.reasoningTokens) || 0,
              cache: {
                write: Number(u.cacheWrite) || 0,
                read: Number(u.cacheRead) || 0,
              },
            };
          }
        }
        return;
      }

      // ---- tool_execution_start: capture args by toolCallId ----
      if (event.type === 'tool_execution_start') {
        if (typeof event.toolCallId === 'string' && event.toolName) {
          pendingToolCalls.set(event.toolCallId, {
            name: event.toolName,
            args: event.args || {},
          });
        }
        return;
      }

      // ---- tool_execution_end: map result to summary fields ----
      if (event.type === 'tool_execution_end') {
        const pending = event.toolCallId
          ? pendingToolCalls.get(event.toolCallId)
          : null;
        const toolName = pending?.name ?? event.toolName ?? 'unknown';
        const args = pending?.args ?? {};
        const result = event.result || {};
        const isError = event.isError === true || result.isError === true;

        // Clean up tracking
        if (event.toolCallId) {
          pendingToolCalls.delete(event.toolCallId);
        }

        if (toolName === 'bash') {
          const command = { command: args.command ?? '', status: isError ? 'error' : 'completed' };
          if (!isError && result.content) {
            const texts = Array.isArray(result.content)
              ? result.content.filter((c) => c?.type === 'text').map((c) => c.text).join('')
              : '';
            if (texts) {
              command.output = texts;
            }
          }
          summary.commandsExecuted.push(command);
        }

        if (toolName === 'read') {
          summary.filesRead.push({
            path: args.path ?? null,
            status: isError ? 'error' : 'completed',
          });
        }

        if (toolName === 'edit' || toolName === 'write') {
          summary.filesModified.push({
            path: args.path ?? null,
            operation: toolName,
          });
        }

        if (isError) {
          summary.errors.push({
            tool: toolName,
            callID: event.toolCallId ?? null,
            error: result.error ?? 'unknown_error',
            context: Object.keys(args).length > 0 ? args : undefined,
          });
        }

        return;
      }
    },

    getSummary() {
      return summary;
    },

    resolveModel(tier) {
      return resolveModel('omp', tier);
    },

    classifyStderr(stderr) {
      const classified = classifyOmpStderr(stderr);
      if (classified) {
        summary.modelErrors.push(classified);
      }
      return classified;
    },

    validateSession(stderr, expectedSessionId, returnedSessionId) {
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
