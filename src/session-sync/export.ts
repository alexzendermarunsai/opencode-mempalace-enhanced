import type { MemoryCandidate, RawSession, SessionSyncConfig, SyncState } from "./contracts.js";
import { normalizeSession, stableKey } from "./normalize.js";
import { isTransientNoise, truncateCandidate } from "./filters.js";
import { routeCandidate } from "./routing.js";

export type CandidateExport = {
  candidates: MemoryCandidate[];
  messagesScanned: number;
  messagesKept: number;
  messagesDropped: number;
  messagesFilteredNoise: number;
  skipped: string[];
};

export function candidatesFromSessions(sessions: RawSession[], config: SessionSyncConfig, state: SyncState, workspaceDir: string): CandidateExport {
  const candidates: MemoryCandidate[] = [];
  const skipped: string[] = [];
  let messagesScanned = 0;
  let messagesKept = 0;
  let messagesFilteredNoise = 0;

  for (const session of sessions) {
    messagesScanned += session.messages.length;
    const exchanges = normalizeSession(session);
    for (const exchange of exchanges) {
      if (isTransientNoise(exchange.content)) {
        messagesFilteredNoise++;
        continue;
      }
      const content = truncateCandidate(exchange.content, config.maxCandidateBytes);
      const route = routeCandidate(content, config, session.projectDir || workspaceDir);
      const contentHash = stableKey([content]);
      const idempotencyKey = stableKey([session.id, String(exchange.exchangeIndex), session.sourceFile, route.wing, route.room, contentHash]);
      if (state.processed[idempotencyKey]) {
        skipped.push(idempotencyKey);
        continue;
      }
      candidates.push({
        idempotencyKey,
        sessionId: session.id,
        exchangeIndex: exchange.exchangeIndex,
        scope: route.scope,
        wing: route.wing,
        room: route.room,
        sourceFile: session.sourceFile,
        content,
        reason: route.scope === "global" ? `clear ${route.room} signal` : "project session memory",
      });
      messagesKept++;
      if (candidates.length >= config.limitCandidates) break;
    }
    if (candidates.length >= config.limitCandidates) break;
  }

  return { candidates, messagesScanned, messagesKept, messagesDropped: Math.max(0, messagesScanned - messagesKept), messagesFilteredNoise, skipped };
}
