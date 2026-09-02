import type { ChatStreamEvent } from './types';

/**
 * Streams a chat message to the worker and invokes onEvent for each
 * parsed server-sent event as it arrives.
 *
 * Uses a plain fetch + manual stream read rather than EventSource,
 * because EventSource only supports GET - we need POST to send the
 * message body.
 */
export async function streamChatMessage(
  workerUrl: string,
  sessionId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const response = await fetch(`${workerUrl}/api/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    onEvent({
      type: 'error',
      value: body?.error ?? `Request failed (${response.status}).`,
    });
    return;
  }
  if (!response.body) {
    onEvent({ type: 'error', value: 'No response stream received.' });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice('data:'.length).trim();
      if (!payload) continue;

      const parsed = JSON.parse(payload) as ChatStreamEvent;
      onEvent(parsed);
    }
  }
}
