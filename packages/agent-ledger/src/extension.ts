import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendLedger, createRunTracker, defaultLedgerDir } from "./ledger.mjs";

export default function (pi: ExtensionAPI) {
  const tracker = createRunTracker();
  const ledgerDir = defaultLedgerDir();

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
  };

  pi.on("input", (event) => {
    try {
      tracker.begin(event.text);
    } catch {
      return;
    }
  });

  pi.on("agent_start", () => {
    try {
      tracker.start();
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
    if (tracker.isEmpty()) return;
    flush(ctx, false);
  });
}
