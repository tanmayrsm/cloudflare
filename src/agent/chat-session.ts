import type { ChatMessage, ChatStreamEvent, Env } from '../types';
import { retrieveRelevantChunks } from '../lib/retrieval';
import { buildSystemPrompt } from './system-prompt';
import { flagsAsSuspicious, validateUserMessage } from '../lib/guardrails';

const LLM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Maximum number of prior turns (user+assistant pairs) sent to the model
 * as context. Unbounded history is both a cost problem (every token gets
 * re-sent and re-billed every turn) and eventually a hard failure once the
 * conversation exceeds the model's context window. A production system
 * would summarize older turns instead of dropping them outright; for this
 * project's scope, bounded truncation is the honest, correctly-scaled
 * choice rather than pretending unlimited memory is free.
 */
const MAX_HISTORY_TURNS = 10;

interface LlmStreamChunk {
  response?: string;
}

export class ChatSession {
  private state: DurableObjectState;
  private env: Env;
  private history: ChatMessage[] = [];
  private historyLoaded = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async loadHistory(): Promise<void> {
    if (this.historyLoaded) return;
    const stored = await this.state.storage.get<ChatMessage[]>('history');
    this.history = stored ?? [];
    this.historyLoaded = true;
  }

  private async saveHistory(): Promise<void> {
    await this.state.storage.put('history', this.history);
  }

  private truncatedHistory(): ChatMessage[] {
    const maxMessages = MAX_HISTORY_TURNS * 2;
    if (this.history.length <= maxMessages) return this.history;
    return this.history.slice(this.history.length - maxMessages);
  }

  async fetch(request: Request): Promise<Response> {
    await this.loadHistory();
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/history')) {
      return Response.json({ history: this.history });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/message')) {
      return this.handleMessage(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleMessage(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const message = (body as { message?: unknown }).message;
    const validation = validateUserMessage(message);
    if (!validation.valid) {
      return Response.json({ error: validation.reason }, { status: 400 });
    }
    const userMessage = (message as string).trim();

    if (flagsAsSuspicious(userMessage)) {
      // Logged for monitoring only - never blocked on this signal alone.
      // See lib/guardrails.ts for why keyword-based blocking is not the
      // real defense here.
      console.warn('Message flagged as potentially injection-like:', {
        sessionId: this.state.id.toString(),
      });
    }

    const retrievedChunks = await retrieveRelevantChunks(this.env, userMessage);
    const systemPrompt = buildSystemPrompt(retrievedChunks);

    this.history.push({ role: 'user', content: userMessage, timestamp: Date.now() });

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const encoder = new TextEncoder();
        const send = (event: ChatStreamEvent): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        send({ type: 'sources', value: retrievedChunks });

        let assistantReply = '';
        try {
          assistantReply = await this.streamCompletion(systemPrompt, send);
          this.history.push({
            role: 'assistant',
            content: assistantReply,
            timestamp: Date.now(),
          });
          await this.saveHistory();
          send({ type: 'done' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error.';
          send({ type: 'error', value: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  /**
   * Calls Workers AI with streaming enabled, forwarding each token to the
   * caller as it arrives, and returns the full assembled reply so the
   * caller can persist it to history once generation finishes.
   */
  private async streamCompletion(
    systemPrompt: string,
    send: (event: ChatStreamEvent) => void,
  ): Promise<string> {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...this.truncatedHistory().map((m) => ({ role: m.role, content: m.content })),
    ];

    const aiResult: unknown = await this.env.AI.run(LLM_MODEL, {
      messages,
      stream: true,
    });

    if (!(aiResult instanceof ReadableStream)) {
      throw new Error('Workers AI did not return a stream for a streaming request.');
    }

    const reader: ReadableStreamDefaultReader<unknown> = aiResult.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullReply = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error('Workers AI stream yielded a non-byte chunk.');
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice('data:'.length).trim();
        if (payload === '[DONE]') continue;

        const parsed = JSON.parse(payload) as LlmStreamChunk;
        const token = parsed.response ?? '';
        if (token) {
          fullReply += token;
          send({ type: 'token', value: token });
        }
      }
    }

    return fullReply;
  }
}
