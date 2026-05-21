import type { WakeUpScope } from "../config/index.js";

let primarySessionID: string | null = null;

export function _resetSessionKindForTesting(): void {
  primarySessionID = null;
}

export function shouldInjectWakeUp(
  sessionID: string,
  scope: WakeUpScope,
): boolean {
  if (scope === "none") return false;
  if (scope === "all-sessions") return true;

  if (!primarySessionID) {
    primarySessionID = sessionID;
    return true;
  }

  return sessionID === primarySessionID;
}
