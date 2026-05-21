import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const PalaceModeSchema = z.enum(["global", "workspace"]);
export type PalaceMode = z.infer<typeof PalaceModeSchema>;

export type ResolvePalacePathOptions = {
  palacePath?: string;
  palaceMode?: PalaceMode;
  workspaceDir?: string;
  homeDir?: string;
};

export type ResolvedPalacePath = {
  palacePath: string;
  palaceMode: PalaceMode;
  source: "palacePath" | "palaceMode";
};

export function defaultGlobalPalacePath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".mempalace", "palace");
}

export function defaultWorkspacePalacePath(workspaceDir = process.cwd()): string {
  return path.join(workspaceDir, ".mempalace", "palace");
}

export function resolvePalacePath(options: ResolvePalacePathOptions = {}): ResolvedPalacePath {
  const explicitPath = options.palacePath;
  const palaceMode = options.palaceMode ?? "global";

  if (explicitPath && explicitPath.trim().length > 0) {
    return {
      palacePath: explicitPath,
      palaceMode,
      source: "palacePath",
    };
  }

  return {
    palacePath: palaceMode === "workspace"
      ? defaultWorkspacePalacePath(options.workspaceDir)
      : defaultGlobalPalacePath(options.homeDir),
    palaceMode,
    source: "palaceMode",
  };
}
