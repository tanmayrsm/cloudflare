export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  score: number;
}

export type ChatStreamEvent =
  | { type: 'token'; value: string }
  | { type: 'sources'; value: RetrievedChunk[] }
  | { type: 'done' }
  | { type: 'error'; value: string };
