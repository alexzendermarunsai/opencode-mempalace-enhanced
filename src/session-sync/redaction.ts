export type RedactionResult = { text: string; warnings: string[] };

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp; replace: string | ((match: string, ...groups: string[]) => string) }> = [
  { label: "Bearer token", pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, replace: "$1[REDACTED]" },
  { label: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replace: "[REDACTED_GITHUB_TOKEN]" },
  { label: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replace: "[REDACTED_OPENAI_KEY]" },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: "[REDACTED_AWS_ACCESS_KEY]" },
  { label: "private key block", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, replace: "[REDACTED_PRIVATE_KEY]" },
  {
    label: "environment secret assignment",
    pattern: /(\b(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*)(["']?)([^\s"']{4,})(\2)/g,
    replace: (_match: string, lhs: string, quote: string, _value: string, closing: string) => `${lhs}${quote}[REDACTED]${closing}`,
  },
];

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const warnings = new Set<string>();

  for (const { label, pattern, replace } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    warnings.add(`Redacted ${label} from preview content`);
    pattern.lastIndex = 0;
    text = typeof replace === "string" ? text.replace(pattern, replace) : text.replace(pattern, replace);
  }

  return { text, warnings: Array.from(warnings) };
}
