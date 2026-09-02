/**
 * Cloudflare binding types for this Worker, plus the shared domain types
 * used across routes, the Durable Object, and the retrieval/guardrail logic.
 */

export interface Env {
  AI: Ai;
  CHAT_SESSION: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Epoch millis; used for bounded-history truncation. */
  timestamp: number;
}

export interface DocChunk {
  id: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
}

export interface RetrievedChunk extends DocChunk {
  score: number;
}

/** Client -> Worker request body for POST /session/:id/message */
export interface SendMessageRequest {
  message: string;
}

/** Server-Sent Event payload shapes streamed back to the client. */
export type ChatStreamEvent =
  | { type: 'token'; value: string }
  | { type: 'sources'; value: RetrievedChunk[] }
  | { type: 'done' }
  | { type: 'error'; value: string };
