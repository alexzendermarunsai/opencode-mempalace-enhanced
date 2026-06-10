import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const wakeUpMock = mock(async () => "Loaded project memory");

mock.module("../mempalace-cli.js", () => ({
  wakeUp: wakeUpMock,
}));

import { createHooks } from "./index.js";
import { StateManager } from "../shared/state.js";
import { DEFAULT_SESSION_SYNC_CONFIG } from "../session-sync/contracts.js";
import { WakeUpInjectionStateManager } from "../shared/wake-up-injection-state.js";
import type { WakeUpInjectionMode } from "../shared/wake-up-injection-state.js";
import type { WakeUpScope } from "../config/index.js";
import { _resetSessionKindForTesting } from "../shared/session-kind.js";

type InitState = "ready" | "initializing" | "empty";

function clearMock(fn: { mockClear?: () => void; mock?: { calls: unknown[] } }): void {
  if (fn.mockClear) fn.mockClear();
  else if (fn.mock) fn.mock.calls.length = 0;
}

function output(text = "Hello"): { parts: Array<{ type: string; text?: string }> } {
  return { parts: [{ type: "text", text }] };
}

describe("chat.message wake-up injection guard", () => {
  let testDir: string;
  let statePath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-up-guard-"));
    statePath = path.join(testDir, "state.json");
    clearMock(wakeUpMock);
    wakeUpMock.mockImplementation(async () => "Loaded project memory");
    _resetSessionKindForTesting();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    _resetSessionKindForTesting();
  });

  function makeHooks(initState: InitState = "ready", mode: WakeUpInjectionMode = "once-per-session", scope: WakeUpScope = "primary-session") {
    return createHooks({
      sessionsSeen: new Set(),
      diaryWritten: new Set(),
      wing: "wing_test",
      workspaceDir: testDir,
      stateManager: new StateManager(99),
      disableAutoLoad: false,
      autoMiningEnabled: false,
      sessionSyncConfig: DEFAULT_SESSION_SYNC_CONFIG,
      wakeUpInjectionMode: mode,
      wakeUpInjectionState: mode === "once-per-session" ? new WakeUpInjectionStateManager(statePath) : undefined,
      ensureInitialized: async () => initState,
      wakeUpScope: scope,
      projectWing: "wing_test",
    });
  }

  it("injects a new session once", async () => {
    const hooks = makeHooks("ready");
    const out = output();

    await hooks.chatMessage({ sessionID: "s1" }, out);

    expect(out.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(out.parts[0]?.text).toContain("Use wing=\"wing_test\" for project-scoped MCP calls");
    expect(out.parts[0]?.text).toContain("Loaded project memory");
    expect(wakeUpMock).toHaveBeenCalledTimes(1);
    expect(new WakeUpInjectionStateManager(statePath)._recordForTesting("s1")?.status).toBe("loaded");
  });

  it("does not duplicate for the same session in the same process", async () => {
    const hooks = makeHooks("ready");
    await hooks.chatMessage({ sessionID: "s1" }, output("First"));

    const second = output("Second");
    await hooks.chatMessage({ sessionID: "s1" }, second);

    expect(second.parts[0]?.text).toBe("Second");
    expect(wakeUpMock).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate after a simulated restart when loaded state is persisted", async () => {
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, output("First"));
    clearMock(wakeUpMock);

    const afterRestart = output("After restart");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, afterRestart);

    expect(afterRestart.parts[0]?.text).toBe("After restart");
    expect(wakeUpMock).not.toHaveBeenCalled();
  });

  it("does not duplicate after a simulated restart when empty state is persisted", async () => {
    const first = output("First");
    await makeHooks("empty").chatMessage({ sessionID: "s1" }, first);
    expect(first.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(new WakeUpInjectionStateManager(statePath)._recordForTesting("s1")?.status).toBe("empty");
    clearMock(wakeUpMock);

    const afterRestart = output("After restart");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, afterRestart);

    expect(afterRestart.parts[0]?.text).toBe("After restart");
    expect(wakeUpMock).not.toHaveBeenCalled();
  });

  it("skips wakeUp for second session when scope is primary-session", async () => {
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, output("First"));
    clearMock(wakeUpMock);

    const different = output("Different");
    await makeHooks("ready").chatMessage({ sessionID: "s2" }, different);

    expect(different.parts[0]?.text).toBe("Different");
    expect(wakeUpMock).not.toHaveBeenCalled();
  });

  it("still injects full wake-up for second session when scope is all-sessions", async () => {
    await makeHooks("ready", "once-per-session", "all-sessions").chatMessage({ sessionID: "s1" }, output("First"));
    clearMock(wakeUpMock);

    const different = output("Different");
    await makeHooks("ready", "once-per-session", "all-sessions").chatMessage({ sessionID: "s2" }, different);

    expect(different.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(wakeUpMock).toHaveBeenCalledTimes(1);
  });

  it("once-per-process preserves restart-time reinjection behavior", async () => {
    await makeHooks("ready", "once-per-process").chatMessage({ sessionID: "s1" }, output("First"));

    const afterRestart = output("After restart");
    await makeHooks("ready", "once-per-process").chatMessage({ sessionID: "s1" }, afterRestart);

    expect(afterRestart.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(wakeUpMock).toHaveBeenCalledTimes(2);
  });

  it("initializing state allows a later restart retry", async () => {
    const initializing = output("First");
    await makeHooks("initializing").chatMessage({ sessionID: "s1" }, initializing);
    expect(initializing.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(new WakeUpInjectionStateManager(statePath)._recordForTesting("s1")?.status).toBe("initializing");
    clearMock(wakeUpMock);

    const ready = output("Ready now");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, ready);

    expect(ready.parts[0]?.text).toContain("Loaded project memory");
    expect(wakeUpMock).toHaveBeenCalledTimes(1);
    expect(new WakeUpInjectionStateManager(statePath)._recordForTesting("s1")?.status).toBe("loaded");
  });

  it("persists null-result guard when wakeUp returns null and suppresses on restart", async () => {
    wakeUpMock.mockImplementation(async () => null);
    const first = output("First");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, first);

    // No visible injection, but guard should be persisted
    expect(first.parts[0]?.text).toBe("First");
    expect(new WakeUpInjectionStateManager(statePath)._recordForTesting("s1")?.status).toBe("null-result");

    // Simulate restart — wakeUp now works
    clearMock(wakeUpMock);
    wakeUpMock.mockImplementation(async () => "Loaded project memory");
    const afterRestart = output("After restart");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, afterRestart);

    // Should NOT re-inject — null-result guard prevents it
    expect(afterRestart.parts[0]?.text).toBe("After restart");
    expect(wakeUpMock).not.toHaveBeenCalled();
  });

  it("does not re-attempt wakeUp on restart when null-result guard exists and wakeUp still returns null", async () => {
    wakeUpMock.mockImplementation(async () => null);
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, output("First"));
    clearMock(wakeUpMock);
    wakeUpMock.mockImplementation(async () => null);

    const afterRestart = output("After restart");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, afterRestart);

    expect(afterRestart.parts[0]?.text).toBe("After restart");
    expect(wakeUpMock).not.toHaveBeenCalled();
  });

  it("missing or corrupt persistent state does not crash injection", async () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "not json");

    const out = output("Hello");
    await makeHooks("ready").chatMessage({ sessionID: "s1" }, out);

    expect(out.parts[0]?.text).toContain("[SYSTEM — MemPalace Context Load]");
    expect(wakeUpMock).toHaveBeenCalledTimes(1);
  });
});
