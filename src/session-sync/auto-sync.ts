import type { AutoSyncResult, MemPalaceWriter, SessionSyncConfig } from "./contracts.js";
import { discoverSessionsWithWarnings } from "./discovery.js";
import { candidatesFromSessions } from "./export.js";
import { createMemPalaceWriter, ingestCandidates } from "./ingest.js";
import { loadState, saveState } from "./state.js";

let stateQueue: Promise<void> = Promise.resolve();

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = stateQueue;
  let release!: () => void;
  stateQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

function emptyResult(status: AutoSyncResult["status"], sessionId: string, warnings: string[] = []): AutoSyncResult {
  return { status, sessionId, attempted: 0, inserted: 0, skippedAlreadySeen: 0, failed: [], warnings };
}

export async function autoSyncSession(config: SessionSyncConfig, workspaceDir: string, sessionId: string, writer?: MemPalaceWriter): Promise<AutoSyncResult> {
  if (!config.enabled || !config.autoSync) return emptyResult("disabled", sessionId);

  try {
    return await withStateLock(async () => {
      const state = loadState(config.statePath);
      const discovery = await discoverSessionsWithWarnings(config, workspaceDir, { sessionId });
      if (discovery.sessions.length === 0) return emptyResult("not_found", sessionId, discovery.warnings);

      const exported = candidatesFromSessions(discovery.sessions, config, state, workspaceDir);
      const skippedAlreadySeen = exported.skipped.length;
      const result = await ingestCandidates(`auto_${sessionId}`, exported.candidates, state, writer ?? createMemPalaceWriter({ palacePath: config.palacePath }));
      saveState(state, config.statePath);

      const failed = result.failed;
      return {
        status: failed.length > 0 ? (result.inserted > 0 || result.skippedAlreadySeen > 0 ? "partial_failure" : "failed") : "success",
        sessionId,
        attempted: result.attempted,
        inserted: result.inserted,
        skippedAlreadySeen: skippedAlreadySeen + result.skippedAlreadySeen,
        failed,
        warnings: [...discovery.warnings, ...exported.warnings],
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...emptyResult("failed", sessionId), failed: [{ idempotencyKey: "auto_sync", error: message }], warnings: [message] };
  }
}
