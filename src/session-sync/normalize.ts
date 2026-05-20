import crypto from "node:crypto";
import type { NormalizedExchange, RawMessage, RawSession } from "./contracts.js";

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
  }
  return "";
}

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripSystemContext(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let stripping = false;
  let sawContextContent = false;
  let waitingForUserText = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[SYSTEM [—-] MemPalace Context Load\]$/.test(trimmed)) {
      stripping = true;
      sawContextContent = false;
      waitingForUserText = false;
      continue;
    }

    if (!stripping) {
      output.push(line);
      continue;
    }

    // Strip every context line until the first blank separator after context content.
    // After that separator, preserve the next non-blank line as the actual user request.
    if (!waitingForUserText) {
      if (!trimmed) {
        if (sawContextContent) waitingForUserText = true;
        continue;
      }
      sawContextContent = true;
      continue;
    }

    if (!trimmed) continue;
    stripping = false;
    output.push(line);
  }

  return output.join("\n").trim();
}

export function messageText(message: RawMessage): string {
  const fromParts = Array.isArray(message.parts)
    ? message.parts
        .filter((part) => !part.type || part.type === "text" || part.type === "message")
        .map((part) => part.text ?? part.content ?? "")
        .join("\n")
    : "";
  return normalizeText(fromParts || textFromContent(message.content) || message.text || "");
}

export function extractFinalAssistantAnswer(messages: RawMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.role !== "assistant") continue;
    if (message.metadata?.type === "reasoning" || message.metadata?.toolCall) continue;
    const text = messageText(message);
    if (text) return text;
  }
  return null;
}

export function buildSessionMemoryText(messages: RawMessage[]): string {
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map(messageText)
    .filter(Boolean)
    .map((text) => `User: ${text}`);
  const finalAnswer = extractFinalAssistantAnswer(messages);
  const parts = [...userTexts, ...(finalAnswer ? [`Assistant final: ${finalAnswer}`] : [])];
  return normalizeText(parts.join("\n\n"));
}

export function normalizeSession(session: RawSession): NormalizedExchange[] {
  const exchanges: NormalizedExchange[] = [];
  let pendingUserText: string | null = null;
  let assistantTexts: string[] = [];

  const flush = () => {
    const userText = normalizeText(pendingUserText ?? "");
    const assistantText = normalizeText(assistantTexts.at(-1) ?? "");
    if (!userText || !assistantText) return;
    const content = normalizeText(`User: ${userText}\n\nAssistant final: ${assistantText}`);
    if (!content) return;
    exchanges.push({
      sessionId: session.id,
      sessionTitle: session.title,
      sessionDirectory: session.projectDir,
      sessionUpdated: session.updatedAt,
      exchangeIndex: exchanges.length,
      userText,
      assistantText,
      content,
      sourceFile: session.sourceFile,
    });
  };

  for (const message of session.messages) {
    if (message.role === "user") {
      flush();
      pendingUserText = stripSystemContext(messageText(message));
      assistantTexts = [];
      continue;
    }
    if (message.role === "assistant" && pendingUserText) {
      if (message.metadata?.type === "reasoning" || message.metadata?.toolCall) continue;
      const text = messageText(message);
      if (text) assistantTexts.push(text);
    }
  }
  flush();
  return exchanges;
}

export function stableKey(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}
