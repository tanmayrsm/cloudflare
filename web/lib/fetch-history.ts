import type { ChatMessage } from './types';

interface HistoryResponse {
  history: ChatMessage[];
}

export async function fetchHistory(
  workerUrl: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  const response = await fetch(`${workerUrl}/api/session/${sessionId}/history`);
  if (!response.ok) {
    throw new Error(`Failed to load history (${response.status}).`);
  }
  const body = (await response.json()) as HistoryResponse;
  return body.history;
}
