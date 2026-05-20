import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RawMessage, RawSession, SessionSyncConfig } from "./contracts.js";
import { runCommandWithOutput } from "../spawn.js";

export function defaultOpenCodeSqlitePath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

function messagesFromJson(value: unknown): RawMessage[] {
  const record = value as Record<string, unknown>;
  const messages = record.messages ?? record.items ?? record.events;
  return Array.isArray(messages) ? (messages as RawMessage[]) : [];
}

function sessionFromFile(file: string, projectDir?: string): RawSession | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const messages = messagesFromJson(raw);
    if (messages.length === 0) return null;
    const stat = fs.statSync(file);
    return {
      id: String(raw.id ?? raw.sessionID ?? path.basename(file, path.extname(file))),
      provider: "opencode-cli",
      projectDir: String(raw.projectDir ?? raw.directory ?? projectDir ?? ""),
      title: typeof raw.title === "string" ? raw.title : undefined,
      sourceFile: file,
      updatedAt: stat.mtimeMs,
      messages,
    };
  } catch {
    return null;
  }
}

function candidateRoots(projectDir: string): string[] {
  return [
    path.join(projectDir, ".opencode"),
    path.join(os.homedir(), ".local", "share", "opencode"),
    path.join(os.homedir(), ".config", "opencode"),
  ];
}

function walkJson(root: string, limit: number, files: string[] = []): string[] {
  if (files.length >= limit || !fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkJson(full, limit, files);
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
    if (files.length >= limit) break;
  }
  return files;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function discoverSqliteSessions(sqlitePath: string, limit: number, projectDir?: string): Promise<RawSession[]> {
  if (!fs.existsSync(sqlitePath)) return [];
  try {
    const sqlite = await import("bun:sqlite");
    const db = new sqlite.Database(sqlitePath, { readonly: true });
    const tables = db.query("select name from sqlite_master where type='table'").all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((row) => row.name));
    if (tableNames.has("session") && tableNames.has("message") && tableNames.has("part")) {
      const sessions = discoverOpenCodeSqliteSessions(db, sqlitePath, limit, projectDir);
      db.close();
      return sessions;
    }
    const table = tables.find((row) => /message|session/i.test(row.name))?.name;
    if (!table) {
      db.close();
      return [];
    }
    const safeTable = table.replace(/"/g, "");
    const rows = db.query(`select * from "${safeTable}" limit 1000`).all() as Array<Record<string, unknown>>;
    const grouped = new Map<string, RawMessage[]>();
    for (const row of rows) {
      const role = String(row.role ?? row.author ?? row.type ?? "");
      const content = row.content ?? row.text ?? row.message;
      if (!role || !content) continue;
      const sessionId = String(row.session_id ?? row.sessionID ?? row.sessionId ?? row.id ?? "sqlite");
      const list = grouped.get(sessionId) ?? [];
      list.push({ role, content });
      grouped.set(sessionId, list);
    }
    db.close();
    return Array.from(grouped.entries()).slice(0, limit).map(([id, messages]) => ({ id, provider: "sqlite" as const, sourceFile: sqlitePath, messages }));
  } catch {
    return [];
  }
}

function discoverOpenCodeSqliteSessions(db: { query: (sql: string) => { all: (...params: any[]) => unknown[] } }, sqlitePath: string, limit: number, projectDir?: string): RawSession[] {
  const select = "select id, directory, title, time_updated from \"session\"";
  const filtered = projectDir
    ? db.query(`${select} where directory = ? order by time_updated desc limit ?`).all(projectDir, limit) as Array<Record<string, unknown>>
    : [];
  const sessionRows = filtered.length > 0
    ? filtered
    : db.query(`${select} order by time_updated desc limit ?`).all(limit) as Array<Record<string, unknown>>;

  return sessionRows.map((session): RawSession | null => {
    const sessionId = String(session.id ?? "");
    if (!sessionId) return null;
    const messageRows = db.query("select id, data, time_created, time_updated from message where session_id = ? order by time_created asc, id asc").all(sessionId) as Array<Record<string, unknown>>;
    const messages: RawMessage[] = [];
    for (const message of messageRows) {
      const messageId = String(message.id ?? "");
      if (!messageId) continue;
      const messageData = parseJsonRecord(message.data);
      const role = typeof messageData.role === "string" ? messageData.role : undefined;
      if (!role) continue;
      const partRows = db.query("select data, time_created from part where session_id = ? and message_id = ? order by time_created asc, id asc").all(sessionId, messageId) as Array<Record<string, unknown>>;
      const text = partRows
        .map((part) => parseJsonRecord(part.data))
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => String(part.text).trim())
        .filter(Boolean)
        .join("\n");
      if (!text) continue;
      messages.push({ role, content: text });
    }
    if (messages.length === 0) return null;
    return {
      id: sessionId,
      provider: "sqlite",
      projectDir: typeof session.directory === "string" ? session.directory : undefined,
      title: typeof session.title === "string" ? session.title : undefined,
      updatedAt: typeof session.time_updated === "number" ? session.time_updated : Number(session.time_updated ?? 0) || undefined,
      sourceFile: sqlitePath,
      messages,
    };
  }).filter((session): session is RawSession => Boolean(session));
}

export async function discoverSessions(config: SessionSyncConfig, projectDir: string): Promise<RawSession[]> {
  if (config.discoveryMode === "sqlite" || config.discoveryMode === "auto") {
    const sqlitePath = config.sqlitePath ?? (config.discoveryMode === "auto" ? defaultOpenCodeSqlitePath() : undefined);
    if (sqlitePath) {
      const sessions = await discoverSqliteSessions(sqlitePath, config.limitSessions, projectDir);
    if (sessions.length > 0 || config.discoveryMode === "sqlite") return sessions;
    }
  }

  if ((config.discoveryMode === "cli" || config.discoveryMode === "auto") && config.cliCommand?.length) {
    const cmd = config.cliCommand[0];
    const args = config.cliCommand.slice(1);
    if (!cmd) return [];
    const output = await runCommandWithOutput(cmd, args, 10_000);
    if (output) {
      try {
        const parsed = JSON.parse(output) as unknown[];
        if (Array.isArray(parsed)) return parsed.map((item, index) => ({ ...(item as RawSession), provider: "opencode-cli" as const, id: String((item as RawSession).id ?? index), sourceFile: (item as RawSession).sourceFile ?? "opencode-cli" })).slice(0, config.limitSessions);
      } catch {}
    }
  }

  const files = candidateRoots(projectDir).flatMap((root) => walkJson(root, config.limitCandidates));
  return files
    .map((file) => sessionFromFile(file, projectDir))
    .filter((session): session is RawSession => Boolean(session))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, config.limitSessions);
}
