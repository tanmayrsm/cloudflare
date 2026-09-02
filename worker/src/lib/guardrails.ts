/**
 * Guardrails: input validation and prompt-injection awareness.
 *
 * Honest note on scope: no regex or keyword list reliably "blocks" prompt
 * injection - that's an open research problem, not something solved by
 * string matching. What we do instead, layered:
 *
 *   1. Hard limits on input shape (length, non-empty) - cheap, unambiguous.
 *   2. Lightweight pattern *flagging* (not blocking) for known injection
 *      phrasing, so it shows up in logs/monitoring rather than silently
 *      succeeding. False positives are expected and acceptable here since
 *      we never block on this signal alone.
 *   3. The real defense lives in the prompt structure itself (see
 *      agent/system-prompt.ts): user input and retrieved doc content are
 *      clearly delimited as DATA, and the system prompt explicitly tells
 *      the model not to treat content inside those delimiters as new
 *      instructions.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUserMessage(message: unknown): ValidationResult {
  if (typeof message !== 'string') {
    return { valid: false, reason: 'Message must be a string.' };
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Message cannot be empty.' };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      reason: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

const SUSPECT_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior) instructions/i,
  /you are now/i,
  /reveal (your|the) system prompt/i,
  /disregard (the|your) (rules|guidelines|instructions)/i,
];

/**
 * Returns true if the message contains phrasing commonly associated with
 * prompt-injection attempts. This is a monitoring signal, not a filter -
 * callers should log it, never use it to silently reject a message.
 */
export function flagsAsSuspicious(message: string): boolean {
  return SUSPECT_PATTERNS.some((pattern) => pattern.test(message));
}
