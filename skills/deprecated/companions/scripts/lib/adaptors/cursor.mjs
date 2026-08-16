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

export function classifyCursorStderr(stderr) {
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

function getToolName(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    return 'unknown';
  }
  return Object.keys(toolCall).find((k) => k.endsWith('ToolCall')) ?? 'unknown';
}

function getToolData(toolCall, toolName) {
  if (!toolCall || typeof toolCall !== 'object') {
    return {};
  }
  return toolCall[toolName] ?? {};
}

export function createCursorAdaptor() {
  const summary = createBaseSummary();

  return {
    push(event) {
      if (!event || typeof event !== 'object') {
        return;
      }

      if (typeof event.session_id === 'string' && summary.sessionID === undefined) {
        summary.sessionID = event.session_id;
      }

      if (event.type === 'tool_call' && event.subtype === 'completed') {
        const toolCall = event.tool_call ?? {};
        const toolName = getToolName(toolCall);
        const toolData = getToolData(toolCall, toolName);
        const args = toolData.args ?? {};
        const result = toolData.result ?? {};

        if (toolName === 'readToolCall' && result.success) {
          summary.filesRead.push({ path: args.path ?? null, status: 'completed' });
        }

        if (toolName === 'editToolCall' && result.success) {
          summary.filesModified.push({ path: args.path ?? null, operation: 'edit' });
        }

        if (toolName === 'shellToolCall' && result.success) {
          summary.commandsExecuted.push({ command: args.command ?? '', status: 'completed' });
        }

        if (!result.success) {
          summary.errors.push({
            tool: toolName,
            error: result.error ?? 'unknown_error',
            context: Object.keys(args).length > 0 ? args : undefined,
          });
        }

        return;
      }

      if (event.type === 'assistant') {
        const content = Array.isArray(event.message?.content) ? event.message.content : [];
        const texts = content
          .filter(item => item?.type === 'text' && typeof item.text === 'string')
          .map(item => item.text);
        summary.finalMessage = texts.join('');
        return;
      }

      if (event.type === 'result' && event.usage && typeof event.usage === 'object') {
        const usage = event.usage;
        summary.tokenUsage = {
          input: Number(usage.inputTokens) || 0,
          output: Number(usage.outputTokens) || 0,
          total: (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0),
          reasoning: 0,
          cache: {
            write: Number(usage.cacheWriteTokens) || 0,
            read: Number(usage.cacheReadTokens) || 0,
          },
        };
      }
    },
    getSummary() {
      return summary;
    },
    resolveModel(tier) {
      return resolveModel('cursor', tier);
    },
    classifyStderr(stderr) {
      const classified = classifyCursorStderr(stderr);
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
