import path from "node:path";
import type { Route, SessionSyncConfig } from "./contracts.js";
import { getWingFromPath } from "../shared/utils.js";

export function projectWingFor(config: SessionSyncConfig, workspaceDir: string): string {
  if (config.projectWingStrategy === "custom" && config.projectWing) return config.projectWing;
  if (config.projectWingStrategy === "skill") return "opencode_mempalace";
  return getWingFromPath(path.resolve(workspaceDir));
}

const GLOBAL_PREFERENCE_PATTERNS = [
  /\bi prefer\b/i,
  /\bmy preference\b/i,
  /\balways use\b/i,
  /\bacross projects\b/i,
  /\bfor all projects\b/i,
  /\bremember that i\b/i,
];

const GLOBAL_DECISION_PATTERNS = [
  /\bdurable decision\b/i,
  /\bglobal decision\b/i,
];

const GLOBAL_LESSON_PATTERNS = [
  /\blesson learned\b/i,
  /\brecurring lesson\b/i,
];

export function routeCandidate(text: string, config: SessionSyncConfig, workspaceDir: string): Route {
  const project: Route = { scope: "project", wing: projectWingFor(config, workspaceDir), room: "session_memory" };

  const hasPref = GLOBAL_PREFERENCE_PATTERNS.some((pattern) => pattern.test(text));
  const hasDecision = GLOBAL_DECISION_PATTERNS.some((pattern) => pattern.test(text));
  const hasLesson = GLOBAL_LESSON_PATTERNS.some((pattern) => pattern.test(text));

  // Lessons and decisions take priority over preferences when both match
  if (hasLesson) {
    return { scope: "global", wing: config.globalWing, room: "lessons" };
  }
  if (hasDecision) {
    return { scope: "global", wing: config.globalWing, room: "decisions" };
  }
  if (hasPref) {
    return { scope: "global", wing: config.globalWing, room: "preferences" };
  }

  return project;
}