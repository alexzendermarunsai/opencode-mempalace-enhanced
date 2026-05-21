import type { IngestArgs, IngestResult, MemPalaceWriter, PreviewArgs, PreviewReport, SessionSyncConfig } from "./contracts.js";
import { IngestArgsSchema, PreviewArgsSchema, SessionSyncConfigSchema } from "./contracts.js";
import { discoverSessionsWithWarnings } from "./discovery.js";
import { candidatesFromSessions } from "./export.js";
import { createMemPalaceWriter, ingestCandidates } from "./ingest.js";
import { defaultStatePath, loadState, markPreview, saveState, scanParamsHash } from "./state.js";

export function parseSessionSyncConfig(input: unknown): SessionSyncConfig {
  return SessionSyncConfigSchema.parse(input ?? {});
}

export function resolvePreviewConfig(config: SessionSyncConfig, args: PreviewArgs = {}): { config: SessionSyncConfig; workspaceDir?: string; scanHash: string } {
  const next: SessionSyncConfig = {
    ...config,
    limitSessions: args.limitSessions ?? config.limitSessions,
    limitCandidates: args.limitCandidates ?? config.limitCandidates,
    projectWing: args.projectWing ?? config.projectWing,
    globalWing: args.globalWing ?? config.globalWing,
  };
  if (args.projectWing) next.projectWingStrategy = "custom";
  const scanHash = scanParamsHash({
    sessionId: args.sessionId,
    projectDir: args.projectDir,
    limitSessions: next.limitSessions,
    limitCandidates: next.limitCandidates,
    projectWing: next.projectWing,
    projectWingStrategy: next.projectWingStrategy,
    globalWing: next.globalWing,
    discoveryMode: next.discoveryMode,
    sqlitePath: next.sqlitePath,
    cliCommand: next.cliCommand,
  });
  return { config: next, workspaceDir: args.projectDir, scanHash };
}

export async function previewSessionSync(config: SessionSyncConfig, workspaceDir: string, args: PreviewArgs = {}): Promise<PreviewReport> {
  const parsedArgs = PreviewArgsSchema.parse(args);
  const resolved = resolvePreviewConfig(config, parsedArgs);
  const effectiveWorkspace = resolved.workspaceDir ?? workspaceDir;
  const state = loadState(config.statePath);
  const discovery = await discoverSessionsWithWarnings(resolved.config, effectiveWorkspace, { sessionId: parsedArgs.sessionId });
  const sessions = discovery.sessions;
  const exported = candidatesFromSessions(sessions, resolved.config, state, effectiveWorkspace);
  const previewId = markPreview(state, exported.candidates, resolved.scanHash);
  saveState(state, config.statePath);
  return {
    previewId,
    createdAt: state.lastPreview?.createdAt ?? new Date().toISOString(),
    scannedSessions: sessions.length,
    messagesScanned: exported.messagesScanned,
    messagesKept: exported.messagesKept,
    messagesDropped: exported.messagesDropped,
    messagesFilteredNoise: exported.messagesFilteredNoise,
    candidates: exported.candidates,
    skipped: exported.skipped,
    warnings: [...discovery.warnings, ...exported.warnings],
  };
}

export async function ingestSessionSync(config: SessionSyncConfig, _workspaceDir: string, args: IngestArgs, writer?: MemPalaceWriter): Promise<IngestResult | { error: string }> {
  const parsed = IngestArgsSchema.safeParse(args);
  if (!parsed.success) return { error: "confirm:true, previewId, and valid candidateIds are required" };

  const state = loadState(config.statePath);
  if (config.requirePreview && !state.lastPreview) return { error: "Preview required before ingest" };
  if (config.requirePreview && state.lastPreview?.previewId !== parsed.data.previewId) return { error: "previewId does not match last preview" };

  const lastPreview = state.lastPreview;
  const candidates = lastPreview?.candidates ?? [];
  const allowed = new Set(lastPreview?.candidateKeys ?? []);
  const requested = parsed.data.candidateIds ?? Array.from(allowed);
  const unknown = requested.filter((id) => !allowed.has(id));
  if (unknown.length > 0) return { error: `candidateIds not found in last preview: ${unknown.join(", ")}` };

  const selected = candidates.filter((candidate) => requested.includes(candidate.idempotencyKey));
  const result = await ingestCandidates(parsed.data.previewId, selected, state, writer ?? createMemPalaceWriter({ palacePath: config.palacePath }));
  saveState(state, config.statePath);
  return result;
}

export function statusSessionSync(config: SessionSyncConfig) {
  const state = loadState(config.statePath);
  const mode = !config.enabled ? "disabled" : config.autoSync ? "curated-auto-sync" : "manual";
  const base = {
    enabled: config.enabled,
    autoSync: config.autoSync,
    mode,
    ...(config.autoSyncThreshold !== undefined ? { autoSyncThreshold: config.autoSyncThreshold } : {}),
    statePath: config.statePath ?? defaultStatePath(),
    lastPreview: state.lastPreview ? { previewId: state.lastPreview.previewId, createdAt: state.lastPreview.createdAt } : undefined,
    processedCount: Object.keys(state.processed).length,
    warnings: [] as string[],
    errors: [] as string[],
  };
  if (!config.enabled) return { ...base, message: "OpenCode session sync is disabled. Set sessionSync.enabled=true to enable preview and ingest." };
  return base;
}

export * from "./contracts.js";
export * from "./auto-sync.js";
