import type { PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { StateManager } from "../shared/state.js";
import { PALACE_PROTOCOL, MAX_MEMORY_LENGTH, STATUS_MESSAGES } from "../shared/protocol.js";
import { log, logWarn } from "../shared/logger.js";
import { wakeUp } from "../mempalace-cli.js";
import type { MempalaceCliOptions } from "../mempalace-cli.js";
import type { SessionSyncConfig } from "../session-sync/contracts.js";
import { autoSyncSession } from "../session-sync/auto-sync.js";
import type { WakeUpInjectionMode, WakeUpInjectionStateManager, WakeUpInjectionStatus } from "../shared/wake-up-injection-state.js";
import type { WakeUpScope } from "../config/index.js";
import { shouldInjectWakeUp } from "../shared/session-kind.js";

export interface HooksContext {
  sessionsSeen: Set<string>;
  diaryWritten: Set<string>;
  wing: string;
  workspaceDir: string;
  stateManager: StateManager;
  disableAutoLoad: boolean;
  autoMiningEnabled: boolean;
  sessionSyncConfig: SessionSyncConfig;
  wakeUpInjectionMode: WakeUpInjectionMode;
  wakeUpInjectionState?: WakeUpInjectionStateManager;
  mempalaceCliOptions?: MempalaceCliOptions;
  ensureInitialized: () => Promise<"ready" | "initializing" | "empty">;
  wakeUpScope: WakeUpScope;
}

export interface CreatedHooks {
  systemTransform: (input: { sessionID?: string; model: unknown }, output: { system: string[] }) => Promise<void>;
  chatMessage: (input: { sessionID: string; messageID?: string; agent?: string }, output: { parts: Array<{ type: string; text?: string; [key: string]: unknown }> }) => Promise<void>;
  toolExecuteAfter: (input: { tool: string; sessionID: string; callID: string; args: unknown }) => Promise<void>;
  sessionCompacting: (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => Promise<void>;
  event: (params: { event: unknown }) => Promise<void>;
}

export function shouldResetCountAfterAutoSync(result: Awaited<ReturnType<typeof autoSyncSession>>): boolean {
  if (result.failed.length > 0) return false;
  if (result.status !== "success") return false;
  return result.inserted > 0 || result.skippedAlreadySeen > 0 || result.attempted === 0;
}

export function createHooks(context: HooksContext): CreatedHooks {
  const { sessionsSeen, diaryWritten, wing, workspaceDir, stateManager, disableAutoLoad, autoMiningEnabled, sessionSyncConfig, wakeUpInjectionMode, wakeUpInjectionState, mempalaceCliOptions, ensureInitialized, wakeUpScope } = context;
  const useCuratedAutoSync = autoMiningEnabled && sessionSyncConfig.enabled && sessionSyncConfig.autoSync;

  const scheduleMining = (sessionID: string, resetLegacyCount: boolean): void => {
    setTimeout(() => {
      if (useCuratedAutoSync) {
        autoSyncSession(sessionSyncConfig, workspaceDir, sessionID)
          .then((result) => {
            if (shouldResetCountAfterAutoSync(result)) stateManager.resetCount(sessionID);
            else stateManager.markPending(sessionID);
          })
          .catch(() => {
            stateManager.markPending(sessionID);
          })
          .finally(() => {
            stateManager.releaseMiningLock(sessionID);
          });
        return;
      }

      import("../mempalace-cli.js")
        .then(({ mine }) => mine(workspaceDir, "convos", wing, mempalaceCliOptions))
        .catch(() => {})
        .finally(() => {
          stateManager.releaseMiningLock(sessionID);
          if (resetLegacyCount) stateManager.resetCount(sessionID);
        });
    }, 2000);
  };

  return {
    // System prompt transformation
    async systemTransform(_input, output) {
      output.system.push(PALACE_PROTOCOL);
    },

    // First message wakeUp injection
    async chatMessage(input, output) {
      // Only inject wakeUp on first message of session
      if (!disableAutoLoad && !sessionsSeen.has(input.sessionID)) {
        const usePersistentWakeUpGuard = wakeUpInjectionMode === "once-per-session" && wakeUpInjectionState;
        const injectWakeUp = shouldInjectWakeUp(input.sessionID, wakeUpScope);

        if (usePersistentWakeUpGuard && wakeUpInjectionState.shouldSuppress(input.sessionID)) {
          sessionsSeen.add(input.sessionID);
        } else if (!injectWakeUp) {
          sessionsSeen.add(input.sessionID);
        } else {
          sessionsSeen.add(input.sessionID);

          const state = await ensureInitialized();
          let memoryText = "";
          let injectionStatus: WakeUpInjectionStatus | undefined;

          if (state === "empty") {
            memoryText = STATUS_MESSAGES.empty;
            injectionStatus = "empty";
          } else if (state === "initializing") {
            memoryText = STATUS_MESSAGES.initializing;
            injectionStatus = "initializing";
          } else if (state === "ready") {
            const memory = await wakeUp(wing, mempalaceCliOptions);
            if (memory) {
              memoryText = memory.length > MAX_MEMORY_LENGTH
                ? memory.substring(0, MAX_MEMORY_LENGTH) + "\n...[Memory Truncated]"
                : memory;
              injectionStatus = "loaded";
            }
          }

          if (memoryText) {
            const firstTextPart = output.parts.find((p) => p.type === "text");
            if (firstTextPart && "text" in firstTextPart) {
              firstTextPart.text = `[SYSTEM — MemPalace Context Load]\n${memoryText}\n\n${firstTextPart.text}`;
              if (usePersistentWakeUpGuard && injectionStatus) {
                wakeUpInjectionState.markInjected(input.sessionID, injectionStatus);
              }
            }
          }
        }
      }

      // Auto-mining: increment message counter
      if (autoMiningEnabled && stateManager.incrementAndCheck(input.sessionID)) {
        if (stateManager.acquireMiningLock(input.sessionID)) {
          const state = await ensureInitialized();
          if (state !== "ready") {
            stateManager.releaseMiningLock(input.sessionID);
            return;
          }

          scheduleMining(input.sessionID, false);
        }
      }
    },

    // Track diary writes
    async toolExecuteAfter(input) {
      if (input.tool === "mcp_mempalace_mempalace_diary_write") {
        diaryWritten.add(input.sessionID);
      }
    },

    // Pre-compaction reminder
    async sessionCompacting(input, output) {
      // Check diary first
      if (!diaryWritten.has(input.sessionID)) {
        output.context.push(STATUS_MESSAGES.diaryReminder);
      }

      // Then inject memory context
      const state = await ensureInitialized();

      if (state === "empty") {
        output.context.push(STATUS_MESSAGES.empty);
        return;
      }

      if (state === "initializing") {
        output.context.push(STATUS_MESSAGES.initializing);
        return;
      }

      // state === "ready" - load memory via wakeUp
      const memory = await wakeUp(wing, mempalaceCliOptions);
      if (memory) {
        const truncatedMemory =
          memory.length > MAX_MEMORY_LENGTH
            ? memory.substring(0, MAX_MEMORY_LENGTH) + "\n...[Memory Truncated]"
            : memory;
        output.context.push(truncatedMemory);
      }
    },

    // Event-driven auto-mining
    async event(params) {
      const ev = params.event as {
        type?: string;
        properties?: {
          sessionID?: string;
          info?: { id?: string };
          status?: { type?: string };
        };
      };
      
      const isIdleEvent =
        ev.type === "session.idle" ||
        ev.type === "session.deleted" ||
        (ev.type === "session.status" && ev.properties?.status?.type === "idle");
        
      if (!isIdleEvent) return;
      
      const sessionID = ev.properties?.sessionID ?? ev.properties?.info?.id;
      if (!sessionID || !stateManager.hasPendingMessages(sessionID)) return;
      if (!stateManager.acquireMiningLock(sessionID)) return;

      const state = await ensureInitialized();
      if (state !== "ready") {
        stateManager.releaseMiningLock(sessionID);
        return;
      }

      scheduleMining(sessionID, true);
    },
  };
}
