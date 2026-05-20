const NOISE_PATTERNS = [
  /^\s*(ok|okay|thanks|thank you|done|great)\s*[.!]*\s*$/i,
  /^(running|executing|checking|inspecting|i.ll inspect|i.ll run)\b.{0,120}$/i,
  /^(bun test|bun run|npm test|pytest|git status)\b/i,
  /^\s*(tool call|tool result|thinking|reasoning|stack trace omitted)\b/i,
  /^\s*(calling|called)\s+tool\b/i,
  /^\s*```(?:json|text)?\s*\{?\s*"?(tool|call|result)/i,
];

export function isTransientNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 24) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function truncateCandidate(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return Buffer.from(bytes.subarray(0, maxBytes)).toString("utf8").replace(/\uFFFD$/u, "").trimEnd();
}
