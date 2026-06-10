import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type WakeUpInjectionMode = "once-per-session" | "once-per-process";
export type WakeUpInjectionStatus = "loaded" | "empty" | "initializing" | "null-result";

export type WakeUpInjectionRecord = {
  status: WakeUpInjectionStatus;
  injectedAt: string;
};

export type WakeUpInjectionState = {
  version: 1;
  sessions: Record<string, WakeUpInjectionRecord>;
};

const MAX_SESSION_RECORDS = 1000;
const MAX_RECORD_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function defaultWakeUpInjectionStatePath(): string {
  return path.join(os.homedir(), ".mempalace", "opencode-mempalace", "state.json");
}

export function emptyWakeUpInjectionState(): WakeUpInjectionState {
  return { version: 1, sessions: {} };
}

export function loadWakeUpInjectionState(statePath = defaultWakeUpInjectionStatePath()): WakeUpInjectionState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as WakeUpInjectionState;
    if (parsed?.version === 1 && parsed.sessions && typeof parsed.sessions === "object") {
      return pruneWakeUpInjectionState(parsed);
    }
  } catch {
    // Missing or corrupt persistent guard state must never block plugin startup.
  }

  return emptyWakeUpInjectionState();
}

export function saveWakeUpInjectionState(state: WakeUpInjectionState, statePath = defaultWakeUpInjectionStatePath()): void {
  const file = statePath;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodIfSupported(dir, 0o700);

  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pruneWakeUpInjectionState(state), null, 2), { mode: 0o600 });
  chmodIfSupported(tmp, 0o600);
  fs.renameSync(tmp, file);
  chmodIfSupported(file, 0o600);
}

export function shouldSuppressWakeUpInjection(record: WakeUpInjectionRecord | undefined): boolean {
  return record?.status === "loaded" || record?.status === "empty" || record?.status === "null-result";
}

export function pruneWakeUpInjectionState(state: WakeUpInjectionState, now = Date.now()): WakeUpInjectionState {
  const entries = Object.entries(state.sessions)
    .filter(([, record]) => {
      if (!record || typeof record.injectedAt !== "string") return false;
      if (record.status !== "loaded" && record.status !== "empty" && record.status !== "initializing" && record.status !== "null-result") return false;
      const injectedTime = Date.parse(record.injectedAt);
      if (!Number.isFinite(injectedTime)) return false;
      return now - injectedTime <= MAX_RECORD_AGE_MS;
    })
    .sort(([, a], [, b]) => Date.parse(b.injectedAt) - Date.parse(a.injectedAt))
    .slice(0, MAX_SESSION_RECORDS);

  return { version: 1, sessions: Object.fromEntries(entries) };
}

export class WakeUpInjectionStateManager {
  private state: WakeUpInjectionState;

  constructor(private readonly statePath: string = defaultWakeUpInjectionStatePath()) {
    this.state = loadWakeUpInjectionState(this.statePath);
  }

  shouldSuppress(sessionID: string): boolean {
    this.state = loadWakeUpInjectionState(this.statePath);
    return shouldSuppressWakeUpInjection(this.state.sessions[sessionID]);
  }

  markInjected(sessionID: string, status: WakeUpInjectionStatus, injectedAt = new Date().toISOString()): void {
    this.state = loadWakeUpInjectionState(this.statePath);
    this.state.sessions[sessionID] = { status, injectedAt };
    this.state = pruneWakeUpInjectionState(this.state);

    try {
      saveWakeUpInjectionState(this.state, this.statePath);
    } catch {
      // Persistence is a duplicate-injection guard, not a critical path.
      // Keep the in-memory record and avoid crashing chat.message hooks.
    }
  }

  _recordForTesting(sessionID: string): WakeUpInjectionRecord | undefined {
    return this.state.sessions[sessionID];
  }
}

function chmodIfSupported(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Some filesystems/platforms do not support POSIX modes; atomic state writes still succeed.
  }
}
