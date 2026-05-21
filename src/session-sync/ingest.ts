import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IngestResult, MemPalaceWriter, MemoryCandidate, SyncState, WriteResult } from "./contracts.js";
import { stableKey } from "./normalize.js";

export type MemPalaceWriterOptions = { palacePath?: string };
type PythonCommandEnv = { [key: string]: string | undefined; MEMPALACE_PYTHON?: string };
export type BuildCandidatePythonCommandsOptions = {
  env: PythonCommandEnv;
  homeDir: string;
  exists: (filePath: string) => boolean;
};

const ADD_DRAWER_SCRIPT = String.raw`
import json
import sys

try:
    from mempalace.mcp_server import tool_add_drawer
    payload = json.loads(sys.stdin.read() or "{}")
    result = tool_add_drawer(
        wing=payload["wing"],
        room=payload["room"],
        content=payload["content"],
        source_file=payload.get("source_file"),
        added_by=payload.get("added_by", "opencode-session-sync"),
    )
    print(json.dumps(result))
    sys.exit(0 if result.get("success") else 2)
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
`;

export function buildCandidatePythonCommands({ env, homeDir, exists }: BuildCandidatePythonCommandsOptions): string[] {
  const commands = [
    env.MEMPALACE_PYTHON,
    path.join(homeDir, ".local", "share", "uv", "tools", "mempalace", "bin", "python3"),
    path.join(homeDir, ".venvs", "mempalace", "bin", "python"),
    path.join(homeDir, ".venvs", "mempalace", "bin", "python3"),
    "python3",
    "python",
  ].filter((cmd): cmd is string => Boolean(cmd));

  const seen = new Set<string>();
  return commands.filter((command) => {
    if (path.isAbsolute(command) && !exists(command)) return false;
    if (seen.has(command)) return false;
    seen.add(command);
    return true;
  });
}

export function candidatePythonCommands(): string[] {
  return buildCandidatePythonCommands({ env: process.env, homeDir: os.homedir(), exists: existsSync });
}

export function parseMemPalaceToolResult(stdout: string): { success: boolean; error?: string; drawer_id?: string; reason?: string } | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as { success?: unknown; error?: unknown; drawer_id?: unknown; reason?: unknown };
      if (typeof parsed.success === "boolean") {
        return {
          success: parsed.success,
          error: typeof parsed.error === "string" ? parsed.error : undefined,
          drawer_id: typeof parsed.drawer_id === "string" ? parsed.drawer_id : undefined,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch {
      // Keep scanning earlier lines.
    }
  }
  return null;
}

export function memPalaceWriterEnv(baseEnv: NodeJS.ProcessEnv = process.env, options: MemPalaceWriterOptions = {}): NodeJS.ProcessEnv {
  return options.palacePath ? { ...baseEnv, MEMPALACE_PALACE_PATH: options.palacePath } : { ...baseEnv };
}

export function createMemPalaceWriter(options: MemPalaceWriterOptions = {}): MemPalaceWriter {
  return (candidate) => defaultMemPalaceWriter(candidate, options);
}

export async function defaultMemPalaceWriter(candidate: MemoryCandidate, options: MemPalaceWriterOptions = {}): Promise<WriteResult> {
  const payload = {
    wing: candidate.wing,
    room: candidate.room,
    content: candidate.content,
    source_file: candidate.sourceFile,
    added_by: "opencode-session-sync",
  };

  const errors: string[] = [];
  for (const python of candidatePythonCommands()) {
    const result = spawnSync(python, ["-c", ADD_DRAWER_SCRIPT], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: memPalaceWriterEnv(process.env, options),
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const parsed = parseMemPalaceToolResult(`${stdout}\n${stderr}`);
    if (parsed?.success) return { ok: true };

    const detail = parsed?.error || stderr.trim() || stdout.trim() || result.error?.message || `exit ${result.status ?? "unknown"}`;
    errors.push(`${python}: ${detail}`);
  }

  return { ok: false, error: `No mempalace Python tool_add_drawer command succeeded: ${errors.join(" | ")}` };
}

export async function ingestCandidates(previewId: string, candidates: MemoryCandidate[], state: SyncState, writer: MemPalaceWriter = defaultMemPalaceWriter): Promise<IngestResult> {
  const failed: IngestResult["failed"] = [];
  let inserted = 0;
  let skippedAlreadySeen = 0;

  for (const candidate of candidates) {
    if (state.processed[candidate.idempotencyKey]) {
      skippedAlreadySeen++;
      continue;
    }
    const result = await writer(candidate);
    if (result.ok) {
      state.processed[candidate.idempotencyKey] = {
        sessionId: candidate.sessionId,
        exchangeIndex: candidate.exchangeIndex,
        contentHash: stableKey([candidate.content]),
        ingestedAt: new Date().toISOString(),
        targetWing: candidate.wing,
        targetRoom: candidate.room,
      };
      inserted++;
    } else {
      failed.push({ idempotencyKey: candidate.idempotencyKey, error: result.error });
    }
  }

  return { previewId, attempted: candidates.length, inserted, skippedAlreadySeen, failed };
}
