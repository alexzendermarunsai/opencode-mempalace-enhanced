import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const runCommandMock = mock(async () => true);
const runCommandSyncMock = mock(() => true);
const runCommandWithOutputMock = mock(async (_cmd: string, args: string[]) => {
  if (args.includes("wake-up")) return "L0|Identity\nL1|Essential Story";
  if (args.includes("status")) return "initialized";
  return null;
});

mock.module("./spawn.js", () => ({
  runCommand: runCommandMock,
  runCommandSync: runCommandSyncMock,
  runCommandWithOutput: runCommandWithOutputMock,
}));

import {
  mine,
  mineSync,
  isInitialized,
  initialize,
  wakeUp,
  _resetForTesting,
} from "./mempalace-cli.js";
import { defaultGlobalPalacePath } from "./config/index.js";

function clearMock(fn: { mockClear?: () => void; mock?: { calls: unknown[] } }): void {
  if (fn.mockClear) fn.mockClear();
  else if (fn.mock) fn.mock.calls.length = 0;
}

describe("Mempalace CLI", () => {
  let testDir: string;
  const palacePath = "/custom/palace";
  const cliCommand = ["/venv/bin/python", "-m", "mempalace"];
  const globalPalacePath = defaultGlobalPalacePath();

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), "mempalace-cli-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    clearMock(runCommandMock);
    clearMock(runCommandSyncMock);
    clearMock(runCommandWithOutputMock);
    runCommandMock.mockImplementation(async () => true);
    runCommandSyncMock.mockImplementation(() => true);
    runCommandWithOutputMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("wake-up")) return "L0|Identity\nL1|Essential Story";
      if (args.includes("status")) return "initialized";
      return null;
    });
    _resetForTesting();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("default fallbacks", () => {
    it("checks global palace status with --palace before subcommand", async () => {
      await isInitialized(testDir);

      expect(runCommandWithOutputMock).toHaveBeenCalledWith(
        "mempalace",
        ["--palace", globalPalacePath, "status"],
        5000,
      );
    });

    it("supports workspace palace mode for project-local status checks", async () => {
      await isInitialized(testDir, { palaceMode: "workspace" });

      expect(runCommandWithOutputMock).toHaveBeenCalledWith(
        "mempalace",
        ["--palace", path.join(testDir, ".mempalace", "palace"), "status"],
        5000,
      );
    });

    it("preserves default fallback command bases", async () => {
      runCommandWithOutputMock.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("status") && args[0] === "-m") return "initialized";
        return null;
      });

      await isInitialized(testDir);

      expect(runCommandWithOutputMock.mock.calls.map((call) => call[0])).toEqual(["mempalace", "python3"]);
      expect(runCommandWithOutputMock.mock.calls[1]?.[1]).toEqual([
        "-m",
        "mempalace",
        "--palace",
        globalPalacePath,
        "status",
      ]);
    });

    it("passes the global default palace to wake-up", async () => {
      await wakeUp("wing_test");

      expect(runCommandWithOutputMock).toHaveBeenCalledWith(
        "mempalace",
        ["--palace", globalPalacePath, "wake-up", "--wing", "wing_test"],
        5000,
      );
    });

    it("passes the global default palace to mine", async () => {
      await mine(testDir, "convos", "wing_test");

      expect(runCommandMock).toHaveBeenCalledWith(
        "mempalace",
        ["--palace", globalPalacePath, "mine", testDir, "--mode", "convos", "--wing", "wing_test"],
        5000,
      );
    });

    it("passes the workspace palace to mine in workspace mode", async () => {
      await mine(testDir, "convos", "wing_test", { palaceMode: "workspace" });

      expect(runCommandMock).toHaveBeenCalledWith(
        "mempalace",
        ["--palace", path.join(testDir, ".mempalace", "palace"), "mine", testDir, "--mode", "convos", "--wing", "wing_test"],
        5000,
      );
    });
  });

  describe("custom cliCommand and palacePath", () => {
    it("uses custom cliCommand and global --palace placement for status", async () => {
      await isInitialized(testDir, { cliCommand, palacePath });

      expect(runCommandWithOutputMock).toHaveBeenCalledWith(
        "/venv/bin/python",
        ["-m", "mempalace", "--palace", palacePath, "status"],
        5000,
      );
    });

    it("uses custom cliCommand and global --palace placement for wake-up", async () => {
      await wakeUp("wing_test", { cliCommand, palacePath });

      expect(runCommandWithOutputMock).toHaveBeenCalledWith(
        "/venv/bin/python",
        ["-m", "mempalace", "--palace", palacePath, "wake-up", "--wing", "wing_test"],
        5000,
      );
    });

    it("uses custom cliCommand and global --palace placement for mine", async () => {
      await mine(testDir, "convos", "wing_test", { cliCommand, palacePath });

      expect(runCommandMock).toHaveBeenCalledWith(
        "/venv/bin/python",
        ["-m", "mempalace", "--palace", palacePath, "mine", testDir, "--mode", "convos", "--wing", "wing_test"],
        5000,
      );
    });

    it("uses custom cliCommand and global --palace placement for mineSync", () => {
      mineSync(testDir, "convos", "wing_test", { cliCommand, palacePath });

      expect(runCommandSyncMock).toHaveBeenCalledWith(
        "/venv/bin/python",
        ["-m", "mempalace", "--palace", palacePath, "mine", testDir, "--mode", "convos", "--wing", "wing_test"],
        5000,
      );
    });

    it("uses custom cliCommand and global --palace placement for init", async () => {
      await initialize(testDir, { cliCommand, palacePath });

      expect(runCommandMock).toHaveBeenCalledWith(
        "/venv/bin/python",
        ["-m", "mempalace", "--palace", palacePath, "init", "--yes", testDir],
        5000,
      );
    });

    it("keys wake-up cache by wing, cliCommand, and palacePath", async () => {
      await wakeUp("wing_test", { cliCommand, palacePath: "/palace/a" });
      await wakeUp("wing_test", { cliCommand, palacePath: "/palace/b" });

      expect(runCommandWithOutputMock.mock.calls.length).toBe(2);
      expect(runCommandWithOutputMock.mock.calls[0]?.[1]).toContain("/palace/a");
      expect(runCommandWithOutputMock.mock.calls[1]?.[1]).toContain("/palace/b");
    });
  });
});
