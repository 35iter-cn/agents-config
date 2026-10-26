import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendLedger, buildOpenRecord, createRunTracker, defaultLedgerDir, detectSource } from "./ledger.mjs";
import { startHeartbeat } from "./heartbeat.mjs";

export default function (pi: ExtensionAPI) {
  const tracker = createRunTracker();
  const ledgerDir = defaultLedgerDir();
  let stopHeartbeat: (() => void) | null = null;

  const flush = (ctx: any, aborted: boolean) => {
    try {
      const record = tracker.drain({
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
        aborted,
      });
      if (record) appendLedger(record, { dir: ledgerDir });
    } catch (error) {
      process.stderr.write(`[agent-ledger] ${(error as Error)?.message ?? error}\n`);
    }
    stopHeartbeat?.();
    stopHeartbeat = null;
  };

  pi.on("input", (event) => {
    try {
      tracker.begin(event.text);
    } catch {
      return;
    }
  });

  pi.on("agent_start", (_event, ctx) => {
    try {
      const track = tracker.start();
      if (!track) return;
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionFile = ctx.sessionManager.getSessionFile();
      const source = detectSource({ env: process.env });
      appendLedger(buildOpenRecord({ sessionId, sessionFile, source, startedAtMs: track.startedAtMs }), { dir: ledgerDir });
      stopHeartbeat?.();
      stopHeartbeat = startHeartbeat({
        sessionId,
        sessionFile,
        source,
        startedAtMs: track.startedAtMs,
        snapshot: () => tracker.snapshot() ?? { userText: "", output: "" },
      });
    } catch {
      return;
    }
  });

  pi.on("message_end", (event) => {
    try {
      tracker.takeOutput(event.message);
    } catch {
      return;
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    flush(ctx, event.aborted);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (tracker.isEmpty()) {
      stopHeartbeat?.();
      stopHeartbeat = null;
      return;
    }
    flush(ctx, false);
  });
}
