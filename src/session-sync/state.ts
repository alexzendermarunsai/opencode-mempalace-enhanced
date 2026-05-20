import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MemoryCandidate, SessionSyncConfig, SyncState } from "./contracts.js";
import { stableKey } from "./normalize.js";

export function defaultStatePath(): string {
  return path.join(os.homedir(), ".mempalace", "opencode-session-sync", "state.json");
}

export function emptyState(): SyncState {
  return { version: 1, processed: {} };
}

export function loadState(statePath?: string): SyncState {
  const file = statePath ?? defaultStatePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SyncState;
    if (parsed?.version === 1 && parsed.processed && typeof parsed.processed === "object") return parsed;
  } catch {
    // Missing or corrupt state is non-fatal.
  }
  return emptyState();
}

export function saveState(state: SyncState, statePath?: string): void {
  const file = statePath ?? defaultStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function scanParamsHash(params: Record<string, unknown>): string {
  return stableKey([JSON.stringify(sortJson(params))]);
}

export function previewIdFor(scanHash: string, candidates: MemoryCandidate[]): string {
  return `preview_${stableKey([scanHash, ...candidates.map((candidate) => candidate.idempotencyKey).sort()]).slice(0, 24)}`;
}

export function markPreview(state: SyncState, candidates: MemoryCandidate[], scanHash: string, createdAt = new Date().toISOString()): string {
  const previewId = previewIdFor(scanHash, candidates);
  state.lastPreview = {
    previewId,
    createdAt,
    candidateKeys: candidates.map((candidate) => candidate.idempotencyKey),
    scanParamsHash: scanHash,
    candidates,
  };
  return previewId;
}

export function configStatePath(config: SessionSyncConfig): string | undefined {
  return config.statePath;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sortJson(val)]));
  }
  return value;
}
