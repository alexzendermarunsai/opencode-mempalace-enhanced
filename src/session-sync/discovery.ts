import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RawMessage, RawSession, SessionSyncConfig } from "./contracts.js";
import { runCommandWithOutput } from "../spawn.js";

type DiscoveryResult = { sessions: RawSession[]; warnings: string[] };
type DiscoveryOptions = { sessionId?: string };

export function defaultOpenCodeSqlitePath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

function messagesFromJson(value: unknown): RawMessage[] {
  const record = value as Record<string, unknown>;
  const messages = record.messages ?? record.items ?? record.events;
  return Array.isArray(messages) ? (messages as RawMessage[]) : [];
}

function capMessages(messages: RawMessage[], config: SessionSyncConfig, sessionLabel: string, warnings: string[]): RawMessage[] {
  const capped = messages.slice(0, config.maxMessagesPerSession).map((message, index) => {
    if (!Array.isArray(message.parts) || message.parts.length <= config.maxPartsPerMessage) return message;
    warnings.push(`Truncated parts for ${sessionLabel} message ${index}; capped at ${config.maxPartsPerMessage}`);
    return { ...message, parts: message.parts.slice(0, config.maxPartsPerMessage) };
  });
  if (messages.length > config.maxMessagesPerSession) warnings.push(`Truncated messages for ${sessionLabel}; capped at ${config.maxMessagesPerSession}`);
  return capped;
}

function sessionFromFile(file: string, projectDir: string | undefined, config: SessionSyncConfig): { session: RawSession | null; warnings: string[] } {
  const warnings: string[] = [];
  try {
    const stat = fs.statSync(file);
    if (stat.size > config.maxJsonFileBytes) {
      return { session: null, warnings: [`Skipped ${file}; JSON file exceeded ${config.maxJsonFileBytes} bytes`] };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const id = String(raw.id ?? raw.sessionID ?? path.basename(file, path.extname(file)));
    const rawProjectDir = typeof raw.projectDir === "string" ? raw.projectDir : typeof raw.directory === "string" ? raw.directory : undefined;
    if (projectDir && rawProjectDir && path.resolve(rawProjectDir) !== path.resolve(projectDir)) {
      warnings.push(`Skipped ${file}; session projectDir ${rawProjectDir} did not match ${projectDir}`);
      return { session: null, warnings };
    }
    const messages = capMessages(messagesFromJson(raw), config, id, warnings);
    if (messages.length === 0) return { session: null, warnings };
    return { session: {
      id,
      provider: "opencode-cli",
      projectDir: String(rawProjectDir ?? projectDir ?? ""),
      title: typeof raw.title === "string" ? raw.title : undefined,
      sourceFile: file,
      updatedAt: stat.mtimeMs,
      messages,
      warnings,
    }, warnings };
  } catch {
    return { session: null, warnings };
  }
}

function candidateRoots(projectDir?: string): string[] {
  if (projectDir) return [path.join(projectDir, ".opencode")];
  return [
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

async function discoverSqliteSessions(sqlitePath: string, config: SessionSyncConfig, projectDir?: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  if (!fs.existsSync(sqlitePath)) return { sessions: [], warnings: [] };
  const warnings: string[] = [];
  try {
    const sqlite = await import("bun:sqlite");
    const db = new sqlite.Database(sqlitePath, { readonly: true });
    const tables = db.query("select name from sqlite_master where type='table'").all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((row) => row.name));
    if (tableNames.has("session") && tableNames.has("message") && tableNames.has("part")) {
      const result = discoverOpenCodeSqliteSessions(db, sqlitePath, config, projectDir, options);
      db.close();
      return result;
    }
    const table = tables.find((row) => /message|session/i.test(row.name))?.name;
    if (!table) {
      db.close();
      return { sessions: [], warnings };
    }
    if (projectDir) {
      db.close();
      return { sessions: [], warnings: [`Skipped SQLite discovery for ${sqlitePath}; schema does not expose session.directory for project-strict filtering`] };
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
    const entries = Array.from(grouped.entries()).filter(([id]) => !options.sessionId || id === options.sessionId);
    return { sessions: entries.slice(0, config.limitSessions).map(([id, messages]) => ({ id, provider: "sqlite" as const, sourceFile: sqlitePath, messages: capMessages(messages, config, id, warnings) })), warnings };
  } catch {
    return { sessions: [], warnings };
  }
}

function discoverOpenCodeSqliteSessions(db: { query: (sql: string) => { all: (...params: any[]) => unknown[] } }, sqlitePath: string, config: SessionSyncConfig, projectDir?: string, options: DiscoveryOptions = {}): DiscoveryResult {
  const warnings: string[] = [];
  const select = "select id, directory, title, time_updated from \"session\"";
  const sessionRows = options.sessionId && projectDir
    ? db.query(`${select} where id = ? and directory = ? order by time_updated desc limit 1`).all(options.sessionId, projectDir) as Array<Record<string, unknown>>
    : options.sessionId
      ? db.query(`${select} where id = ? order by time_updated desc limit 1`).all(options.sessionId) as Array<Record<string, unknown>>
      : projectDir
        ? db.query(`${select} where directory = ? order by time_updated desc limit ?`).all(projectDir, config.limitSessions) as Array<Record<string, unknown>>
        : db.query(`${select} order by time_updated desc limit ?`).all(config.limitSessions) as Array<Record<string, unknown>>;
  if (options.sessionId && sessionRows.length === 0) warnings.push(`No SQLite session found for sessionId ${options.sessionId}${projectDir ? ` and projectDir ${projectDir}` : ""}`);
  else if (projectDir && sessionRows.length === 0) warnings.push(`No SQLite sessions found for projectDir ${projectDir}`);

  const sessions = sessionRows.map((session): RawSession | null => {
    const sessionId = String(session.id ?? "");
    if (!sessionId) return null;
    const allMessageRows = db.query("select id, data, time_created, time_updated from message where session_id = ? order by time_created asc, id asc").all(sessionId) as Array<Record<string, unknown>>;
    const messageRows = allMessageRows.slice(0, config.maxMessagesPerSession);
    if (allMessageRows.length > config.maxMessagesPerSession) warnings.push(`Truncated messages for SQLite session ${sessionId}; capped at ${config.maxMessagesPerSession}`);
    const messages: RawMessage[] = [];
    for (const message of messageRows) {
      const messageId = String(message.id ?? "");
      if (!messageId) continue;
      const messageData = parseJsonRecord(message.data);
      const role = typeof messageData.role === "string" ? messageData.role : undefined;
      if (!role) continue;
      const allPartRows = db.query("select data, time_created from part where session_id = ? and message_id = ? order by time_created asc, id asc").all(sessionId, messageId) as Array<Record<string, unknown>>;
      const partRows = allPartRows.slice(0, config.maxPartsPerMessage);
      if (allPartRows.length > config.maxPartsPerMessage) warnings.push(`Truncated parts for SQLite session ${sessionId} message ${messageId}; capped at ${config.maxPartsPerMessage}`);
      const textParts: string[] = [];
      for (const part of partRows.map((row) => parseJsonRecord(row.data))) {
        if (part.type !== "text" || typeof part.text !== "string") continue;
        const textPart = String(part.text).trim();
        if (!textPart) continue;
        const nextBytes = Buffer.byteLength([...textParts, textPart].join("\n"), "utf8");
        if (nextBytes > config.maxRawExchangeBytes) {
          warnings.push(`Truncated SQLite text for session ${sessionId} message ${messageId}; capped at ${config.maxRawExchangeBytes} bytes`);
          break;
        }
        textParts.push(textPart);
      }
      const text = textParts.join("\n");
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
      warnings,
    };
  }).filter((session): session is RawSession => Boolean(session));
  return { sessions, warnings };
}

export async function discoverSessionsWithWarnings(config: SessionSyncConfig, projectDir?: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  if (config.discoveryMode === "sqlite" || config.discoveryMode === "auto") {
    const sqlitePath = config.sqlitePath ?? (config.discoveryMode === "auto" ? defaultOpenCodeSqlitePath() : undefined);
    if (sqlitePath) {
      const result = await discoverSqliteSessions(sqlitePath, config, projectDir, options);
      warnings.push(...result.warnings);
      if (result.sessions.length > 0 || config.discoveryMode === "sqlite" || (!options.sessionId && projectDir && result.warnings.length > 0)) return { sessions: result.sessions, warnings };
    }
  }

  if ((config.discoveryMode === "cli" || config.discoveryMode === "auto") && config.cliCommand?.length) {
    const cmd = config.cliCommand[0];
    const args = config.cliCommand.slice(1);
    if (!cmd) return { sessions: [], warnings };
    const output = await runCommandWithOutput(cmd, args, 10_000);
    if (output) {
      try {
        const parsed = JSON.parse(output) as unknown[];
        if (Array.isArray(parsed)) {
          const sessions = parsed.map((item, index) => ({ ...(item as RawSession), provider: "opencode-cli" as const, id: String((item as RawSession).id ?? index), sourceFile: (item as RawSession).sourceFile ?? "opencode-cli" }))
            .filter((session) => !options.sessionId || session.id === options.sessionId)
            .slice(0, config.limitSessions);
          return { sessions, warnings };
        }
      } catch {}
    }
  }

  const files = candidateRoots(projectDir).flatMap((root) => walkJson(root, config.limitCandidates));
  const parsed = files.map((file) => sessionFromFile(file, projectDir, config));
  for (const item of parsed) warnings.push(...item.warnings);
  return { sessions: parsed
    .map((item) => item.session)
    .filter((session): session is RawSession => Boolean(session))
    .filter((session) => !options.sessionId || session.id === options.sessionId)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, config.limitSessions), warnings };
}

export async function discoverSessions(config: SessionSyncConfig, projectDir?: string, options: DiscoveryOptions = {}): Promise<RawSession[]> {
  return (await discoverSessionsWithWarnings(config, projectDir, options)).sessions;
}
