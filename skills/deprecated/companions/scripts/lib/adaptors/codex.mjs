import { createBaseSummary } from '../summary.mjs';
import { resolveModel } from '../models.mjs';

const AUTH_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /invalid.*api.*key/i,
  /authentication.*failed/i,
  /Missing environment variable/i,
];

const NETWORK_ERROR_PATTERNS = [
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bEAI_AGAIN\b/,
  /\bunavailable\b/i,
  /Reconnecting/i,
  /unexpected status.*\d{3}/i,
];

const MODEL_UNAVAILABLE_PATTERNS = [
  /model.*not.*found/i,
  /model.*not.*available/i,
  /hit your usage limit/i,
];

/**
 * Classify a codex exec error event message into a structured error.
 */
function classifyCodexEventError(message) {
  if (AUTH_ERROR_PATTERNS.some((p) => p.test(message))) {
    return { class: 'auth_error', name: 'AuthError', message };
  }
  if (MODEL_UNAVAILABLE_PATTERNS.some((p) => p.test(message))) {
    return { class: 'model_unavailable', name: 'ModelUnavailable', message };
  }
  if (NETWORK_ERROR_PATTERNS.some((p) => p.test(message))) {
    return { class: 'network_error', name: 'NetworkError', message };
  }
  return { class: 'unknown', name: 'CodexError', message };
}

/**
 * Classify stderr output from codex exec into a structured error.
 */
function classifyCodexStderr(stderr) {
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

export function createCodexAdaptor() {
  const summary = createBaseSummary();

  return {
    push(event) {
      if (!event || typeof event !== 'object') {
        return;
      }

      const eventType = event.type;

      // ---- thread.started: capture thread_id as sessionID ----
      if (eventType === 'thread.started') {
        if (typeof event.thread_id === 'string' && summary.sessionID === undefined) {
          summary.sessionID = event.thread_id;
        }
        return;
      }

      // ---- turn.started: no-op, just marks the start of work ----
      if (eventType === 'turn.started') {
        return;
      }

      // ---- turn.completed: extract token usage ----
      if (eventType === 'turn.completed') {
        const usage = event.usage;
        if (usage && typeof usage === 'object') {
          summary.tokenUsage = {
            input: Number(usage.input_tokens) || 0,
            output: Number(usage.output_tokens) || 0,
            total: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0),
            reasoning: Number(usage.reasoning_output_tokens) || 0,
            cache: {
              write: Number(usage.cached_input_tokens) || 0,
              read: 0,
            },
          };
        }
        return;
      }

      // ---- turn.failed: record fatal error ----
      if (eventType === 'turn.failed') {
        const err = event.error;
        if (err && typeof err.message === 'string') {
          summary.modelErrors.push({
            class: 'unknown',
            name: 'TurnFailed',
            message: err.message,
          });
        }
        return;
      }

      // ---- error: record non-fatal error ----
      if (eventType === 'error' && typeof event.message === 'string') {
        summary.modelErrors.push(classifyCodexEventError(event.message));
        return;
      }

      // ---- item.*: process items ----
      if (eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') {
        processCodexItem(summary, event);
        return;
      }
    },

    getSummary() {
      return summary;
    },

    resolveModel(tier) {
      return resolveModel('codex', tier);
    },

    classifyStderr(stderr) {
      const classified = classifyCodexStderr(stderr);
      if (classified) {
        summary.modelErrors.push(classified);
      }
      return classified;
    },

    validateSession(stderr, expectedSessionId, returnedSessionId) {
      if (typeof stderr === 'string' && stderr.includes('not found') && stderr.includes('session')) {
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

/**
 * Process a codex item event and update the summary accordingly.
 *
 * Item events carry a nested `item` object with `{ id, type, ...fields }`.
 * The `type` discriminant (snake_case) determines the payload shape.
 */
function processCodexItem(summary, event) {
  const item = event.item;
  if (!item || typeof item !== 'object') {
    return;
  }

  const itemType = item.type;
  const isTerminal = event.type === 'item.completed';
  const isUpdate = event.type === 'item.updated';

  switch (itemType) {
    // ---- agent_message: final text output from the model ----
    case 'agent_message': {
      // Agent message items only emit item.completed (never item.started).
      // The last agent_message before turn completion is the final answer.
      if (isTerminal && typeof item.text === 'string') {
        summary.finalMessage = item.text;
      }
      break;
    }

    // ---- command_execution: bash/shell commands the agent ran ----
    case 'command_execution': {
      // Only record completed/failed commands, not in-progress ones.
      if (!isTerminal && !isUpdate) {
        break;
      }
      const status = item.status;
      if (status === 'in_progress') {
        break;
      }
      const commandStr = typeof item.command === 'string' ? item.command : '';
      if (!commandStr) {
        break;
      }
      const entry = {
        command: commandStr,
        status: status === 'completed' ? 'completed' : 'error',
      };
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
      if (output) {
        entry.output = output;
      }
      summary.commandsExecuted.push(entry);
      break;
    }

    // ---- file_change: file modifications applied by the agent ----
    case 'file_change': {
      // Only record completed/failed changes, not in-progress.
      if (!isTerminal && !isUpdate) {
        break;
      }
      const changeStatus = item.status;
      if (changeStatus === 'in_progress') {
        break;
      }
      const changes = Array.isArray(item.changes) ? item.changes : [];
      for (const change of changes) {
        if (change && typeof change.path === 'string') {
          if (change.kind === 'add' || change.kind === 'update') {
            summary.filesModified.push({
              path: change.path,
              operation: change.kind,
            });
          } else if (change.kind === 'delete') {
            summary.filesModified.push({
              path: change.path,
              operation: 'delete',
            });
          }
        }
      }
      break;
    }

    // ---- reasoning: reasoning trace from the model ----
    case 'reasoning': {
      // Reasoning items emit item.completed with text.
      // We don't record them in summary fields but they're valid events.
      break;
    }

    // ---- mcp_tool_call: MCP tool invocations ----
    case 'mcp_tool_call': {
      if (!isTerminal) {
        break;
      }
      if (item.status === 'failed') {
        const errMsg = item.error?.message || 'mcp_tool_call_failed';
        summary.errors.push({
          tool: `mcp:${item.server}/${item.tool}`,
          callID: item.id ?? null,
          error: errMsg,
          context: { arguments: item.arguments },
        });
      }
      break;
    }

    // ---- web_search: web search performed by the agent ----
    case 'web_search': {
      // Not tracked in summary fields but valid events.
      break;
    }

    // ---- error: error items surfaced by the agent ----
    case 'error': {
      if (isTerminal && typeof item.message === 'string') {
        summary.errors.push({
          tool: 'codex',
          callID: item.id ?? null,
          error: item.message,
        });
      }
      break;
    }

    // ---- todo_list: agent's internal to-do list (skip) ----
    case 'todo_list':
    // ---- collab_tool_call: collaboration tool calls (skip) ----
    case 'collab_tool_call': {
      break;
    }

    default: {
      // Unknown item types are silently ignored.
      break;
    }
  }
}
