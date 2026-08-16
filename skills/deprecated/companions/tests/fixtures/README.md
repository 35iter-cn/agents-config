# Test Fixtures

Real companion CLI JSONL event streams captured from actual executions.
Used to verify adaptors parse real-world output correctly.

## Files

| File | Source | Size | Description |
|------|--------|------|-------------|
| `cursor-runx-implementation.jsonl` | Cursor CLI (`agent --print --output-format stream-json`) | 84.2K | Full session: Cursor implementing the runx.md spec refactor. Contains read/edit/shell tool calls, thinking deltas, and assistant messages. |
| `cursor-simple-chat.jsonl` | Cursor CLI | 1.0K | Short chat session with a single assistant reply and usage data. |
| `cursor-error-session.jsonl` | Cursor CLI | 1016B | Session with tool errors. |
| `opencode-error-bash.jsonl` | OpenCode CLI (dry-run / test) | 148B | Bash tool call that exits with code 2, producing an error event. |
| `opencode-simple-chat.jsonl` | OpenCode CLI | 1.2K | Successful simple chat session with text response and token usage. |
| `opencode-empty-session.jsonl` | OpenCode CLI (dry-run / test) | 0B | Empty session (no events). |
| `opencode-invalid-model.jsonl` | Synthesized | small | OpenCode `UnknownError` event for "Model not found" (→ `model_unavailable`). |
| `opencode-auth-error.jsonl` | Synthesized | small | OpenCode `APIError` with `statusCode: 401`, `isRetryable: false` (→ `auth_error`). |
| `opencode-rate-limited.jsonl` | Synthesized | small | OpenCode `APIError` with `statusCode: 429` (→ `rate_limited`). |
| `opencode-server-error.jsonl` | Synthesized | small | OpenCode `APIError` with `statusCode: 503` (→ `network_error`). |
| `opencode-network-silent.jsonl` | Synthesized | 0B | Empty stream simulating a network hang. |
| `opencode-mid-task-failure.jsonl` | Synthesized | small | Successful write+bash followed by `APIError` (5xx). Used to assert no-retry guard when files/commands already produced. |
| `cursor-network-error.stderr.txt` | Synthesized | small | Cursor stderr with `ECONNREFUSED` (→ `network_error`). |
| `cursor-invalid-model.stderr.txt` | Synthesized | small | Cursor stderr `Cannot use this model: ...` (→ `model_unavailable`). |

## Adding New Fixtures

When adding new fixtures:

1. Copy the raw JSONL log from `/tmp/companions/<YYYY-MM-DD-HH:mm>-<random>.jsonl`
2. Rename with a descriptive slug
3. Update this README
4. Add a test case in `tests/runner.test.mjs` that loads the fixture and asserts on the parsed summary
