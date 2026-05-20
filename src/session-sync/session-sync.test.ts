import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import plugin from "../index.js";
import { parsePluginOptions } from "../config/index.js";
import type { RawSession } from "./contracts.js";
import { DEFAULT_SESSION_SYNC_CONFIG, PreviewArgsSchema } from "./contracts.js";
import { discoverSessions, discoverSessionsWithWarnings } from "./discovery.js";
import { candidatesFromSessions } from "./export.js";
import { isTransientNoise } from "./filters.js";
import { ingestCandidates, memPalaceWriterEnv, parseMemPalaceToolResult } from "./ingest.js";
import { previewSessionSync, ingestSessionSync } from "./index.js";
import { buildSessionMemoryText, extractFinalAssistantAnswer, normalizeSession, normalizeText, stableKey, stripSystemContext } from "./normalize.js";
import { routeCandidate, projectWingFor } from "./routing.js";
import { emptyState, loadState, saveState } from "./state.js";

function sampleSession(text = "Please implement the durable backend plan for this project."): RawSession {
  return {
    id: "s1",
    projectDir: "/tmp/opencode-mempalace",
    sourceFile: "/tmp/session.json",
    messages: [
      { role: "system", content: "hidden" },
      { role: "user", content: text },
      { role: "tool", content: "trace" },
      { role: "assistant", metadata: { type: "reasoning" }, content: "private reasoning" },
      { role: "assistant", content: "Implemented the backend plan and validated the build." },
    ],
  };
}

function createOpenCodeSqliteFixture(dbPath: string, projectDir: string): void {
  const db = new Database(dbPath);
  db.run('create table "session" (id text primary key, directory text, title text, time_updated integer)');
  db.run("create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)");
  db.run("create table part (id text primary key, message_id text, session_id text, time_created integer, data text)");
  insertOpenCodeSqliteSession(db, "ses_live", projectDir, "Live project", 300, "Please fix sqlite discovery for this durable project memory.", "SQLite discovery now joins text parts and ignores tool traces.");
  db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", ["part_user_tool", "msg_user_ses_live", "ses_live", 102, JSON.stringify({ type: "tool", text: "TOOL NOISE" })]);
  db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", ["part_assistant_reasoning", "msg_assistant_ses_live", "ses_live", 201, JSON.stringify({ type: "reasoning", text: "PRIVATE REASONING" })]);
  db.close();
}

function insertOpenCodeSqliteSession(db: Database, id: string, projectDir: string, title: string, updatedAt: number, userText: string, assistantText: string): void {
  db.run('insert into "session" (id, directory, title, time_updated) values (?, ?, ?, ?)', [id, projectDir, title, updatedAt]);
  db.run("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)", [`msg_user_${id}`, id, 100, 100, JSON.stringify({ role: "user" })]);
  db.run("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)", [`msg_assistant_${id}`, id, 200, 200, JSON.stringify({ role: "assistant" })]);
  db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", [`part_user_text_${id}`, `msg_user_${id}`, id, 101, JSON.stringify({ type: "text", text: userText })]);
  db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", [`part_assistant_text_${id}`, `msg_assistant_${id}`, id, 202, JSON.stringify({ type: "text", text: assistantText })]);
}

describe("session sync", () => {
  it("has safe config defaults and preserves disabled behavior", async () => {
    const parsed = parsePluginOptions({});
    expect(parsed.sessionSync.enabled).toBe(false);
    expect(parsed.sessionSync.requirePreview).toBe(true);
    expect(parsed.sessionSync.globalWing).toBe("opencode_global");

    const result = await plugin({ directory: os.tmpdir(), worktree: os.tmpdir() }, { disableAutoUpdate: true });
    expect(result.tool?.mempalace_session_sync_status).toBeDefined();
    expect(result.tool?.mempalace_session_sync_preview).toBeUndefined();
    const status = await result.tool?.mempalace_session_sync_status?.execute?.({}, { sessionID: "s" });
    expect(String(status)).toContain("disabled");
  });

  it("strips MemPalace system context from user text", () => {
    const withContext = "[SYSTEM \u2014 MemPalace Context Load]\n[MemPalace]: The memory system is being built asynchronously...\n\ndone restart , lets test";
    expect(stripSystemContext(withContext)).toBe("done restart , lets test");
    expect(stripSystemContext("[SYSTEM - MemPalace Context Load]\n[MemPalace]: loaded ok")).toBe("");
    const multiLine = "[SYSTEM \u2014 MemPalace Context Load]\n[MemPalace]: Loaded project context\nProject context:\n- prior durable memory\n- another historical line\n\nPlease preserve this actual request.";
    expect(stripSystemContext(multiLine)).toBe("Please preserve this actual request.");
    const withBlankLines = "before\n\n[SYSTEM - MemPalace Context Load]\nStatus: context loaded\n\n\ncontinue after blank";
    expect(stripSystemContext(withBlankLines)).toBe("before\n\ncontinue after blank");
    const withoutContext = "check opencode.json , suggest the best way";
    expect(stripSystemContext(withoutContext)).toBe(withoutContext);
  });

  it("supports project wing strategies and requires custom wing config", () => {
    expect(projectWingFor({ ...DEFAULT_SESSION_SYNC_CONFIG, projectWingStrategy: "plugin" }, "/x/opencode-mempalace")).toBe("wing_opencode-mempalace");
    expect(projectWingFor({ ...DEFAULT_SESSION_SYNC_CONFIG, projectWingStrategy: "skill" }, "/x/opencode-mempalace")).toBe("opencode_mempalace");
    expect(projectWingFor({ ...DEFAULT_SESSION_SYNC_CONFIG, projectWingStrategy: "custom", projectWing: "wing_custom" }, "/x/opencode-mempalace")).toBe("wing_custom");
    const invalid = parsePluginOptions({ sessionSync: { projectWingStrategy: "custom" } });
    expect(invalid.sessionSync.projectWingStrategy).toBe("plugin");
  });

  it("normalizes user text and assistant final answers only", () => {
    expect(normalizeText(" a\t b\n\n\n c ")).toBe("a b\n\n c");
    const session = sampleSession();
    expect(extractFinalAssistantAnswer(session.messages)).toBe("Implemented the backend plan and validated the build.");
    const memory = buildSessionMemoryText(session.messages);
    expect(memory).toContain("User: Please implement");
    expect(memory).toContain("Assistant final: Implemented");
    expect(memory).not.toContain("hidden");
    expect(memory).not.toContain("private reasoning");
    expect(memory).not.toContain("trace");
  });

  it("normalizes deterministic per-user/assistant exchanges without collapsing a session", () => {
    const session: RawSession = {
      id: "multi",
      sourceFile: "/tmp/multi.json",
      projectDir: "/tmp/project",
      title: "multi turn",
      updatedAt: 123,
      messages: [
        { role: "system", content: "system trace" },
        { role: "user", content: "First durable request about the backend." },
        { role: "assistant", content: "First durable final answer." },
        { role: "tool", content: "tool trace" },
        { role: "user", content: "Second durable request about routing." },
        { role: "assistant", metadata: { type: "reasoning" }, content: "hidden reasoning trace" },
        { role: "assistant", content: "Interim assistant text." },
        { role: "assistant", content: "Second durable final answer." },
        { role: "user", content: "No assistant yet should be skipped." },
      ],
    };
    const exchanges = normalizeSession(session);
    expect(exchanges.length).toBe(2);
    expect(exchanges[0].exchangeIndex).toBe(0);
    expect(exchanges[0].content).toContain("First durable request");
    expect(exchanges[0].content).toContain("First durable final answer");
    expect(exchanges[1].exchangeIndex).toBe(1);
    expect(exchanges[1].content).toContain("Second durable request");
    expect(exchanges[1].assistantText).toBe("Second durable final answer.");
    expect(exchanges.map((exchange) => exchange.content).join("\n")).not.toContain("system trace");
    expect(exchanges.map((exchange) => exchange.content).join("\n")).not.toContain("tool trace");
    expect(exchanges.map((exchange) => exchange.content).join("\n")).not.toContain("hidden reasoning trace");
    expect(exchanges.map((exchange) => exchange.content).join("\n")).not.toContain("No assistant yet");
  });

  it("does not filter durable content just because it mentions reasoning", () => {
    const text = "User: Please document why reasoning traces are excluded from durable memory.\n\nAssistant final: We keep final answers and ignore hidden reasoning traces.";
    expect(isTransientNoise(text)).toBe(false);
  });

  it("exports separate candidates for separate exchanges", () => {
    const state = emptyState();
    const session: RawSession = {
      id: "multi-candidate",
      sourceFile: "/tmp/multi-candidate.json",
      projectDir: "/tmp/project",
      messages: [
        { role: "user", content: "Implement the first durable backend behavior." },
        { role: "assistant", content: "The first backend behavior is implemented." },
        { role: "user", content: "Implement the second durable backend behavior." },
        { role: "assistant", content: "The second backend behavior is implemented." },
      ],
    };
    const exported = candidatesFromSessions([session], { ...DEFAULT_SESSION_SYNC_CONFIG, limitCandidates: 10 }, state, "/tmp/project");
    expect(exported.candidates.length).toBe(2);
    expect(exported.candidates[0].exchangeIndex).toBe(0);
    expect(exported.candidates[1].exchangeIndex).toBe(1);
    expect(exported.candidates[0].content).not.toContain("second durable");
  });

  it("redacts common secret patterns in preview candidates and warns", () => {
    const state = emptyState();
    const privateKey = "-----BEGIN PRIVATE KEY-----\nabc123secret\n-----END PRIVATE KEY-----";
    const session: RawSession = {
      id: "secrets",
      sourceFile: "/tmp/secrets.json",
      projectDir: "/tmp/project",
      messages: [
        { role: "user", content: `Please implement durable secret handling. Authorization: Bearer abcdefghijklmnopqrstuvwxyz ghp_abcdefghijklmnopqrstuvwxyz123456 sk-abcdefghijklmnopqrstuvwxyz123456 AKIAABCDEFGHIJKLMNOP SECRET_TOKEN=supersecret ${privateKey}` },
        { role: "assistant", content: "Implemented durable redaction so previews remain useful without exposing credentials." },
      ],
    };
    const exported = candidatesFromSessions([session], DEFAULT_SESSION_SYNC_CONFIG, state, "/tmp/project");
    expect(exported.candidates.length).toBe(1);
    const content = exported.candidates[0].content;
    expect(content).toContain("[REDACTED");
    expect(content).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(content).not.toContain("supersecret");
    expect(content).not.toContain("abc123secret");
    expect(exported.warnings.join("\n")).toContain("Redacted");
  });

  it("redacts before truncating candidate content", () => {
    const state = emptyState();
    const privateKey = "-----BEGIN PRIVATE KEY-----\nabc123secret-that-must-not-leak\n-----END PRIVATE KEY-----";
    const session: RawSession = {
      id: "truncate-secret",
      sourceFile: "/tmp/truncate-secret.json",
      projectDir: "/tmp/project",
      messages: [
        { role: "user", content: `Please store this durable redaction behavior. ${privateKey}` },
        { role: "assistant", content: "Implemented durable redaction before candidate truncation." },
      ],
    };
    const exported = candidatesFromSessions([session], { ...DEFAULT_SESSION_SYNC_CONFIG, maxCandidateBytes: 90 }, state, "/tmp/project");
    expect(exported.candidates.length).toBe(1);
    expect(exported.candidates[0].content).not.toContain("abc123secret");
    expect(exported.candidates[0].content).not.toContain("BEGIN PRIVATE KEY");
    expect(exported.warnings.join("\n")).toContain("private key");
  });

  it("accepts empty optional preview strings as undefined", () => {
    const parsed = PreviewArgsSchema.parse({ sessionId: "", projectDir: "", projectWing: "", globalWing: "" });
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.projectDir).toBeUndefined();
    expect(parsed.projectWing).toBeUndefined();
    expect(parsed.globalWing).toBeUndefined();
  });

  it("discovers OpenCode sqlite sessions by joining message text parts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-sqlite-"));
    const dbPath = path.join(dir, "opencode.db");
    createOpenCodeSqliteFixture(dbPath, dir);
    const sessions = await discoverSessions({ ...DEFAULT_SESSION_SYNC_CONFIG, discoveryMode: "auto", sqlitePath: dbPath }, dir);
    expect(sessions.length).toBe(1);
    expect(sessions[0].provider).toBe("sqlite");
    expect(sessions[0].sourceFile).toBe(dbPath);
    expect(sessions[0].projectDir).toBe(dir);
    expect(sessions[0].title).toBe("Live project");
    const content = sessions[0].messages.map((message) => String(message.content)).join("\n");
    expect(content).toContain("Please fix sqlite discovery");
    expect(content).toContain("SQLite discovery now joins text parts");
    expect(content).not.toContain("TOOL NOISE");
    expect(content).not.toContain("PRIVATE REASONING");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps sqlite discovery project-strict when projectDir is provided", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-sqlite-strict-"));
    const dbPath = path.join(dir, "opencode.db");
    const db = new Database(dbPath);
    db.run('create table "session" (id text primary key, directory text, title text, time_updated integer)');
    db.run("create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)");
    db.run("create table part (id text primary key, message_id text, session_id text, time_created integer, data text)");
    insertOpenCodeSqliteSession(db, "matching", dir, "Matching", 300, "Please implement durable matching project memory.", "Matching project memory was implemented.");
    insertOpenCodeSqliteSession(db, "unrelated", "/tmp/unrelated-project", "Unrelated", 400, "Please implement unrelated project memory.", "Unrelated project memory was implemented.");
    db.close();

    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, discoveryMode: "sqlite" as const, sqlitePath: dbPath, limitSessions: 5 };
    expect((await discoverSessions(config, dir)).map((session) => session.id)).toEqual(["matching"]);
    const missing = await discoverSessionsWithWarnings(config, path.join(dir, "missing"));
    expect(missing.sessions.length).toBe(0);
    expect(missing.warnings.join("\n")).toContain("No SQLite sessions found");

    const statePath = path.join(dir, "state.json");
    const preview = await previewSessionSync({ ...config, enabled: true, statePath }, dir);
    expect(preview.candidates.map((candidate) => candidate.sessionId)).toEqual(["matching"]);
    expect(preview.candidates.map((candidate) => candidate.content).join("\n")).not.toContain("unrelated");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("applies sqlite message and part caps", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-sqlite-caps-"));
    const dbPath = path.join(dir, "opencode.db");
    const db = new Database(dbPath);
    db.run('create table "session" (id text primary key, directory text, title text, time_updated integer)');
    db.run("create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)");
    db.run("create table part (id text primary key, message_id text, session_id text, time_created integer, data text)");
    db.run('insert into "session" (id, directory, title, time_updated) values (?, ?, ?, ?)', ["capped", dir, "Capped", 300]);
    db.run("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)", ["msg1", "capped", 100, 100, JSON.stringify({ role: "user" })]);
    db.run("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)", ["msg2", "capped", 200, 200, JSON.stringify({ role: "assistant" })]);
    db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", ["part1", "msg1", "capped", 101, JSON.stringify({ type: "text", text: "first part durable request" })]);
    db.run("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)", ["part2", "msg1", "capped", 102, JSON.stringify({ type: "text", text: "second part should be capped" })]);
    db.close();

    const result = await discoverSessionsWithWarnings({ ...DEFAULT_SESSION_SYNC_CONFIG, discoveryMode: "sqlite", sqlitePath: dbPath, maxMessagesPerSession: 1, maxPartsPerMessage: 1 }, dir);
    expect(result.sessions[0].messages.length).toBe(1);
    expect(String(result.sessions[0].messages[0].content)).toBe("first part durable request");
    expect(result.warnings.join("\n")).toContain("Truncated messages");
    expect(result.warnings.join("\n")).toContain("Truncated parts");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("previews candidates from sqlite auto discovery", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-sqlite-preview-"));
    const dbPath = path.join(dir, "opencode.db");
    const statePath = path.join(dir, "state.json");
    createOpenCodeSqliteFixture(dbPath, dir);
    const preview = await previewSessionSync({ ...DEFAULT_SESSION_SYNC_CONFIG, enabled: true, sqlitePath: dbPath, statePath }, dir, { projectDir: dir });
    expect(preview.scannedSessions).toBe(1);
    expect(preview.candidates.length).toBe(1);
    expect(preview.candidates[0].content).toContain("Please fix sqlite discovery");
    expect(preview.candidates[0].content).not.toContain("TOOL NOISE");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips oversized JSON session files before reading and warns", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-json-size-"));
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "large.json"), JSON.stringify({ messages: [{ role: "user", content: "x".repeat(200) }] }));
    const result = await discoverSessionsWithWarnings({ ...DEFAULT_SESSION_SYNC_CONFIG, sqlitePath: path.join(dir, "missing.db"), maxJsonFileBytes: 50, limitSessions: 1 }, dir);
    expect(result.sessions.find((session) => session.sourceFile.endsWith("large.json"))).toBeUndefined();
    expect(result.warnings.join("\n")).toContain("JSON file exceeded");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("filters transient noise and routes global conservatively", () => {
    expect(isTransientNoise("ok")).toBe(true);
    expect(isTransientNoise("This captures a durable implementation decision with enough detail.")).toBe(false);
    // Clear cross-project preference → global
    expect(routeCandidate("I prefer concise final answers across projects.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("preferences");
    expect(routeCandidate("Remember that I always use bun for builds.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("preferences");
    // Project plan text with "prefer" / "default" wording → project, not global
    expect(routeCandidate("Prefer keeping this as a separate commit later with default settings.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("session_memory");
    expect(routeCandidate("Implemented local API behavior for this repository.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("session_memory");
    // Global decisions
    expect(routeCandidate("This is a durable decision that applies everywhere.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("decisions");
    // Global lessons
    expect(routeCandidate("Lesson learned across projects: always validate configs.", DEFAULT_SESSION_SYNC_CONFIG, "/x/proj").room).toBe("lessons");
  });

  it("builds stable idempotency keys and skips processed records", () => {
    const state = emptyState();
    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, maxCandidateBytes: 4000 };
    const first = candidatesFromSessions([sampleSession()], config, state, "/tmp/opencode-mempalace");
    expect(first.candidates.length).toBe(1);
    expect(stableKey(["a", "b"])).toBe(stableKey(["a", "b"]));
    state.processed[first.candidates[0].idempotencyKey] = { sessionId: "s1", exchangeIndex: 0, contentHash: "h", ingestedAt: new Date().toISOString(), targetWing: "w", targetRoom: "r" };
    const second = candidatesFromSessions([sampleSession()], config, state, "/tmp/opencode-mempalace");
    expect(second.skipped.length).toBe(1);
  });

  it("writes state atomically and handles corrupt state gracefully", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-state-"));
    const statePath = path.join(dir, "state.json");
    const state = emptyState();
    state.processed.abc = { sessionId: "s", exchangeIndex: 0, contentHash: "h", ingestedAt: "now", targetWing: "w", targetRoom: "r" };
    saveState(state, statePath);
    expect(loadState(statePath).processed.abc.targetWing).toBe("w");
    if (process.platform !== "win32") {
      expect((fs.statSync(dir).mode & 0o777)).toBe(0o700);
      expect((fs.statSync(statePath).mode & 0o777)).toBe(0o600);
    }
    fs.writeFileSync(statePath, "not json");
    expect(Object.keys(loadState(statePath).processed).length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("previews without marking processed and enforces preview-required ingest", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-preview-"));
    const statePath = path.join(dir, "state.json");
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "session.json"), JSON.stringify({ ...sampleSession(), projectDir: dir }));
    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, enabled: true, statePath, limitSessions: 1, sqlitePath: path.join(dir, "missing.db") };

    const guarded = await ingestSessionSync(config, dir, { previewId: "missing", confirm: true }, async () => ({ ok: true }));
    expect("error" in guarded).toBe(true);
    const preview = await previewSessionSync(config, dir);
    expect(preview.candidates.length).toBe(1);
    expect(Object.keys(loadState(statePath).processed).length).toBe(0);
    const ingested = await ingestSessionSync(config, dir, { previewId: preview.previewId, confirm: true }, async () => ({ ok: true }));
    expect("inserted" in ingested && ingested.inserted).toBe(1);
    expect(Object.keys(loadState(statePath).processed).length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records partial ingest failures only after successful writes", async () => {
    const state = emptyState();
    const exported = candidatesFromSessions([sampleSession("Please implement one durable project memory."), { ...sampleSession("Please implement another durable project memory."), id: "s2" }], DEFAULT_SESSION_SYNC_CONFIG, state, "/tmp/opencode-mempalace");
    let calls = 0;
    const result = await ingestCandidates("preview_1", exported.candidates, state, async () => {
      calls++;
      return calls === 1 ? { ok: true } : { ok: false, error: "boom" };
    });
    expect(result.inserted).toBe(1);
    expect(result.failed.length).toBe(1);
    expect(Object.keys(state.processed).length).toBe(1);
  });

  it("parses MemPalace Python tool_add_drawer results", () => {
    expect(parseMemPalaceToolResult('{"success": true, "drawer_id": "drawer_1"}')?.success).toBe(true);
    expect(parseMemPalaceToolResult('log line\n{"success": false, "error": "boom"}')?.error).toBe("boom");
    expect(parseMemPalaceToolResult('not json')).toBeNull();
  });

  it("propagates configured palacePath to the Python writer environment", () => {
    const env = memPalaceWriterEnv({ PATH: "/bin", MEMPALACE_PALACE_PATH: "/old" }, { palacePath: "/custom/palace" });
    expect(env.PATH).toBe("/bin");
    expect(env.MEMPALACE_PALACE_PATH).toBe("/custom/palace");
  });

  it("exposes preview and ingest only when enabled", async () => {
    const result = await plugin({ directory: os.tmpdir(), worktree: os.tmpdir() }, { disableAutoUpdate: true, sessionSync: { enabled: true, statePath: path.join(os.tmpdir(), "session-sync-enabled.json") } });
    expect(result.tool?.mempalace_session_sync_preview).toBeDefined();
    expect(result.tool?.mempalace_session_sync_ingest).toBeDefined();
  });

  it("tool schemas include preview and ingest args", async () => {
    const result = await plugin({ directory: os.tmpdir(), worktree: os.tmpdir() }, { disableAutoUpdate: true, sessionSync: { enabled: true, statePath: path.join(os.tmpdir(), "session-sync-schema.json") } });
    expect(result.tool?.mempalace_session_sync_preview?.args.projectDir).toBeUndefined();
    expect(result.tool?.mempalace_session_sync_preview?.args.projectWing).toBeUndefined();
    expect(result.tool?.mempalace_session_sync_preview?.args.globalWing).toBeUndefined();
    expect(result.tool?.mempalace_session_sync_preview?.args.sessionId).toBeDefined();
    expect(result.tool?.mempalace_session_sync_preview?.args.limitCandidates).toBeDefined();
    expect(result.tool?.mempalace_session_sync_ingest?.args.previewId).toBeDefined();
    expect(result.tool?.mempalace_session_sync_ingest?.args.confirm).toBeDefined();
  });

  it("requires confirm true and rejects previewId mismatch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-confirm-"));
    const statePath = path.join(dir, "state.json");
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "session.json"), JSON.stringify({ ...sampleSession(), projectDir: dir }));
    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, enabled: true, statePath, sqlitePath: path.join(dir, "missing.db") };
    const preview = await previewSessionSync(config, dir);
    const missingConfirm = await ingestSessionSync(config, dir, { previewId: preview.previewId, confirm: false as true }, async () => ({ ok: true }));
    expect("error" in missingConfirm).toBe(true);
    const mismatch = await ingestSessionSync(config, dir, { previewId: "preview_wrong", confirm: true }, async () => ({ ok: true }));
    expect("error" in mismatch && mismatch.error).toContain("previewId");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("supports candidateIds subset and stable preview IDs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-subset-"));
    const statePath = path.join(dir, "state.json");
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "one.json"), JSON.stringify({ ...sampleSession("Please implement one durable project memory."), projectDir: dir }));
    fs.writeFileSync(path.join(dir, ".opencode", "two.json"), JSON.stringify({ ...sampleSession("Please implement another durable project memory."), id: "s2", projectDir: dir }));
    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, enabled: true, statePath, limitSessions: 2, sqlitePath: path.join(dir, "missing.db") };
    const first = await previewSessionSync(config, dir);
    const second = await previewSessionSync(config, dir);
    expect(first.previewId).toBe(second.previewId);
    const selected = first.candidates[0].idempotencyKey;
    const ingested = await ingestSessionSync(config, dir, { previewId: first.previewId, candidateIds: [selected], confirm: true }, async () => ({ ok: true }));
    expect("inserted" in ingested && ingested.inserted).toBe(1);
    expect(Object.keys(loadState(statePath).processed).length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("state lastPreview includes scanParamsHash and processed metadata", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-shape-"));
    const statePath = path.join(dir, "state.json");
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "session.json"), JSON.stringify({ ...sampleSession(), projectDir: dir }));
    const config = { ...DEFAULT_SESSION_SYNC_CONFIG, enabled: true, statePath, sqlitePath: path.join(dir, "missing.db") };
    const preview = await previewSessionSync(config, dir, { projectWing: "wing_custom" });
    const stateAfterPreview = loadState(statePath);
    expect(stateAfterPreview.lastPreview?.previewId).toBe(preview.previewId);
    expect(stateAfterPreview.lastPreview?.scanParamsHash).toBeDefined();
    await ingestSessionSync(config, dir, { previewId: preview.previewId, confirm: true }, async () => ({ ok: true }));
    const processed = Object.values(loadState(statePath).processed)[0];
    expect(processed.sessionId).toBe("s1");
    expect(processed.exchangeIndex).toBe(0);
    expect(processed.contentHash).toBeDefined();
    expect(processed.targetWing).toBe("wing_custom");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
