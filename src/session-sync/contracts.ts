import { z } from "zod";

export const WingStrategySchema = z.enum(["plugin", "skill", "custom"]);
export const DiscoveryModeSchema = z.enum(["auto", "cli", "sqlite"]);

export const SessionSyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  requirePreview: z.boolean().default(true),
  discoveryMode: DiscoveryModeSchema.default("auto"),
  limitSessions: z.number().int().positive().max(100).default(3),
  limitCandidates: z.number().int().positive().max(1000).default(50),
  maxCandidateBytes: z.number().int().positive().max(100_000).default(4000),
  projectWingStrategy: WingStrategySchema.default("plugin"),
  projectWing: z.string().min(1).optional(),
  globalWing: z.string().min(1).default("opencode_global"),
  statePath: z.string().min(1).optional(),
  cliCommand: z.array(z.string()).optional(),
  sqlitePath: z.string().min(1).optional(),
}).refine((config) => config.projectWingStrategy !== "custom" || Boolean(config.projectWing), {
  path: ["projectWing"],
  message: "projectWing is required when projectWingStrategy is custom",
});

const OptionalStringFromToolSchema = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

export const PreviewArgsSchema = z.object({
  sessionId: OptionalStringFromToolSchema,
  projectDir: OptionalStringFromToolSchema,
  limitSessions: z.number().int().positive().max(100).optional(),
  limitCandidates: z.number().int().positive().max(1000).optional(),
  projectWing: OptionalStringFromToolSchema,
  globalWing: OptionalStringFromToolSchema,
});

export const IngestArgsSchema = z.object({
  previewId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).optional(),
  confirm: z.literal(true),
});

export type SessionSyncConfig = z.infer<typeof SessionSyncConfigSchema>;
export type PreviewArgs = z.infer<typeof PreviewArgsSchema>;
export type IngestArgs = z.infer<typeof IngestArgsSchema>;
export type RawMessageRole = "user" | "assistant" | "system" | "tool" | string;

export type RawMessage = {
  role?: RawMessageRole;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string; content?: string }>;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type RawSession = {
  id: string;
  provider?: "opencode-cli" | "sqlite";
  projectDir?: string;
  title?: string;
  sourceFile: string;
  updatedAt?: number;
  messages: RawMessage[];
};

export type SessionSource = {
  id: string;
  provider: "opencode-cli" | "sqlite";
  path?: string;
  projectPath?: string;
  title?: string;
  updatedAt?: number;
};

export type NormalizedExchange = {
  sessionId: string;
  sessionTitle?: string;
  sessionDirectory?: string;
  sessionUpdated?: number;
  exchangeIndex: number;
  userText: string;
  assistantText: string;
  content: string;
  sourceFile: string;
};

export type Route = { scope: "project" | "global"; wing: string; room: "session_memory" | "preferences" | "decisions" | "lessons" };

export type MemoryCandidate = {
  idempotencyKey: string;
  sessionId: string;
  exchangeIndex: number;
  scope: "project" | "global";
  wing: string;
  room: "session_memory" | "preferences" | "decisions" | "lessons";
  content: string;
  sourceFile: string;
  reason: string;
};

export type PreviewReport = {
  previewId: string;
  createdAt: string;
  scannedSessions: number;
  messagesScanned: number;
  messagesKept: number;
  messagesDropped: number;
  messagesFilteredNoise: number;
  candidates: MemoryCandidate[];
  skipped: string[];
  warnings: string[];
};

export type IngestResult = {
  previewId: string;
  attempted: number;
  inserted: number;
  skippedAlreadySeen: number;
  failed: Array<{ idempotencyKey: string; error: string }>;
};

export type SessionSyncState = {
  version: 1;
  lastPreview?: {
    previewId: string;
    createdAt: string;
    candidateKeys: string[];
    scanParamsHash: string;
    candidates?: MemoryCandidate[];
  };
  processed: Record<string, { sessionId: string; exchangeIndex: number; contentHash: string; ingestedAt: string; targetWing: string; targetRoom: string }>;
};

export type PreviewSummary = PreviewReport;
export type SyncState = SessionSyncState;
export type WriteResult = { ok: true } | { ok: false; error: string };
export type MemPalaceWriter = (candidate: MemoryCandidate) => Promise<WriteResult>;

export const DEFAULT_SESSION_SYNC_CONFIG: SessionSyncConfig = SessionSyncConfigSchema.parse({});
