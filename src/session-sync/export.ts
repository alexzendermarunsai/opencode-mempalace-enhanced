import type { MemoryCandidate, RawSession, SessionSyncConfig, SyncState } from "./contracts.js";
import { normalizeSession, stableKey } from "./normalize.js";
import { isTransientNoise, truncateCandidate } from "./filters.js";
import { routeCandidate } from "./routing.js";
import { redactSecrets } from "./redaction.js";

export type CandidateExport = {
  candidates: MemoryCandidate[];
  messagesScanned: number;
  messagesKept: number;
  messagesDropped: number;
  messagesFilteredNoise: number;
  skipped: string[];
  warnings: string[];
};

export function candidatesFromSessions(sessions: RawSession[], config: SessionSyncConfig, state: SyncState, workspaceDir: string): CandidateExport {
  const candidates: MemoryCandidate[] = [];
  const skipped: string[] = [];
  let messagesScanned = 0;
  let messagesKept = 0;
  let messagesFilteredNoise = 0;
  const warnings: string[] = [];

  for (const session of sessions) {
    messagesScanned += session.messages.length;
    const exchanges = normalizeSession(session);
    for (const exchange of exchanges) {
      if (isTransientNoise(exchange.content)) {
        messagesFilteredNoise++;
        continue;
      }
      if (Buffer.byteLength(exchange.content, "utf8") > config.maxRawExchangeBytes) {
        skipped.push(`${session.id}:${exchange.exchangeIndex}: raw exchange exceeded ${config.maxRawExchangeBytes} bytes`);
        warnings.push(`Skipped exchange ${session.id}:${exchange.exchangeIndex}; raw exchange exceeded ${config.maxRawExchangeBytes} bytes`);
        continue;
      }
      const redacted = redactSecrets(exchange.content);
      if (redacted.warnings.length) warnings.push(...redacted.warnings.map((warning) => `${warning} in ${session.id}:${exchange.exchangeIndex}`));
      const content = truncateCandidate(redacted.text, config.maxCandidateBytes);
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

  return { candidates, messagesScanned, messagesKept, messagesDropped: Math.max(0, messagesScanned - messagesKept), messagesFilteredNoise, skipped, warnings };
}
