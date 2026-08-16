export function createBaseSummary() {
  return {
    success: false,
    exitCode: null,
    sessionID: undefined,
    filesRead: [],
    filesModified: [],
    commandsExecuted: [],
    errors: [],
    modelErrors: [],
    finalMessage: '',
    tokenUsage: {
      input: 0,
      output: 0,
      total: 0,
      reasoning: 0,
      cache: { write: 0, read: 0 },
    },
    durationMs: 0,
    stderr: undefined,
  };
}
