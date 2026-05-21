/**
 * Enhanced MemPalace CLI with error classification
 * 
 * Following OMO pattern: Wraps operations with error classification
 * for better retry logic and debugging
 */

import {
  runCommand,
  runCommandSync,
  runCommandWithOutput,
} from "./spawn.js";
import { safeAsync, classifyInitError, isRetryableSpawnError } from "./shared/error-classifier.js";
import { logWarn, logError } from "./shared/logger.js";
import { resolvePalacePath, type PalaceMode } from "./config/palace.js";

const CLI_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;

type FallbackCommand = { cmd: string; args: string[] };

export type MempalaceCliOptions = { cliCommand?: string[]; palacePath?: string; palaceMode?: PalaceMode };

function buildCommandBases(options: MempalaceCliOptions = {}): FallbackCommand[] {
  const customCommand = options.cliCommand;
  if (customCommand && customCommand.length > 0) {
    const cmd = customCommand[0];
    const args = customCommand.slice(1);
    if (cmd) return [{ cmd, args }];
  }

  return [
    { cmd: "mempalace", args: [] },
    { cmd: "python3", args: ["-m", "mempalace"] },
    { cmd: "python", args: ["-m", "mempalace"] },
  ];
}

function withPalace(args: string[], palacePath?: string): string[] {
  return palacePath ? ["--palace", palacePath, ...args] : args;
}

function buildCommands(args: string[], options: MempalaceCliOptions = {}, workspaceDir?: string): FallbackCommand[] {
  const resolvedPalacePath = resolvePalacePath({ ...options, workspaceDir }).palacePath;
  const cliArgs = withPalace(args, resolvedPalacePath);
  return buildCommandBases(options).map((base) => ({
    cmd: base.cmd,
    args: [...base.args, ...cliArgs],
  }));
}

function buildMineCommands(
  dir: string,
  mode: string,
  wing: string,
  options: MempalaceCliOptions = {},
): FallbackCommand[] {
  const mineArgs = ["mine", dir, "--mode", mode, "--wing", wing];
  return buildCommands(mineArgs, options, dir);
}

/**
 * Asynchronously mine a workspace directory into the palace.
 * Enhanced with error classification and retry logic.
 */
export async function mine(
  dir: string,
  mode: string,
  wing: string,
  options: MempalaceCliOptions = {},
): Promise<void> {
  const commands = buildMineCommands(dir, mode, wing, options);
  let lastError: Error | null = null;

  for (const { cmd, args } of commands) {
    const result = await safeAsync(
      () => runCommand(cmd, args, CLI_TIMEOUT_MS),
      `mining with ${cmd}`
    );

    if (result.success && result.data) {
      return; // Success
    }

    if (!result.success) {
      lastError = new Error(result.error.message);
      
      // Log classified error
      if (result.retryable) {
        logWarn(`Retryable mining error with ${cmd}`, { error: result.error.message });
      } else {
        logError(`Non-retryable mining error with ${cmd}`, result.error);
      }
    }
  }

  // All fallbacks failed
  if (lastError) {
    const classification = classifyInitError(lastError);
    logError(`Mining failed after all fallbacks`, { classification, message: lastError.message });
  }
}

/**
 * Synchronously mine a workspace directory.
 * Used by process exit handlers.
 */
export function mineSync(dir: string, mode: string, wing: string, options: MempalaceCliOptions = {}): void {
  for (const { cmd, args } of buildMineCommands(dir, mode, wing, options)) {
    if (runCommandSync(cmd, args, CLI_TIMEOUT_MS)) return;
  }
  // Silent failure in sync context
}

/**
 * Check if mempalace is initialized for a workspace.
 * Enhanced with error classification.
 */
export async function isInitialized(dir: string, options: MempalaceCliOptions = {}): Promise<boolean> {
  const commands = buildCommands(["status"], options, dir);

  for (const { cmd, args } of commands) {
    const result = await safeAsync(
      () => runCommandWithOutput(cmd, args, CLI_TIMEOUT_MS),
      `checking initialization with ${cmd}`
    );

    if (result.success && result.data !== null) {
      return true;
    }

    // Classify error for better diagnostics
    if (!result.success) {
      const classification = classifyInitError(new Error(result.error.message));
      if (classification === "missing_dependency") {
        logWarn(`MemPalace dependency check failed with ${cmd}`);
      }
    }
  }
  
  return false;
}

/**
 * Initialize mempalace for a workspace.
 * Enhanced with error classification.
 */
export async function initialize(dir: string, options: MempalaceCliOptions = {}): Promise<void> {
  const initArgs = ["init", "--yes", dir];
  const commands = buildCommands(initArgs, options, dir);

  for (const { cmd, args } of commands) {
    const result = await safeAsync(
      () => runCommand(cmd, args, CLI_TIMEOUT_MS),
      `initializing with ${cmd}`
    );

    if (result.success && result.data) {
      return; // Success
    }

    if (!result.success) {
      const classification = classifyInitError(new Error(result.error.message));
      logWarn(`Initialization attempt failed with ${cmd}`, { classification });
    }
  }
}

// Cache for wakeUp results
let wakeUpCache: Map<string, { result: string; timestamp: number }> = new Map();
const WAKEUP_CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Wake up mempalace and get L0+L1 memory for a wing.
 * Enhanced with caching and error classification.
 */
export async function wakeUp(wing: string, options: MempalaceCliOptions = {}): Promise<string | null> {
  const resolvedPalacePath = resolvePalacePath(options).palacePath;
  // Check cache first
  const cacheKey = JSON.stringify({ wing, cliCommand: options.cliCommand ?? null, palacePath: resolvedPalacePath });
  const cached = wakeUpCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < WAKEUP_CACHE_TTL_MS) {
    return cached.result;
  }

  const commands = buildCommands(["wake-up", "--wing", wing], { ...options, palacePath: resolvedPalacePath });

  for (const { cmd, args } of commands) {
    const result = await safeAsync(
      () => runCommandWithOutput(cmd, args, CLI_TIMEOUT_MS),
      `waking up with ${cmd}`
    );

    if (result.success && result.data && result.data.length > 0) {
      // Cache successful result
      wakeUpCache.set(cacheKey, { result: result.data, timestamp: Date.now() });
      return result.data;
    }

    if (!result.success && isRetryableSpawnError(new Error(result.error.message))) {
      logWarn(`Retryable wakeUp error with ${cmd}`, { error: result.error.message });
    }
  }
  
  return null;
}

/**
 * Clear the wakeUp cache (useful for testing)
 */
export function _clearWakeUpCache(): void {
  wakeUpCache.clear();
}

/**
 * Reset for testing
 */
export function _resetForTesting(): void {
  wakeUpCache.clear();
}
