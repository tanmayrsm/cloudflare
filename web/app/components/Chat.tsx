'use client';

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ChatMessage, RetrievedChunk } from '../../lib/types';
import { getOrCreateSessionId } from '../../lib/session';
import { fetchHistory } from '../../lib/fetch-history';
import { streamChatMessage } from '../../lib/stream-chat';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://127.0.0.1:8787';

interface DisplayMessage extends ChatMessage {
  sources?: RetrievedChunk[];
  isStreaming?: boolean;
  error?: string;
}

export default function Chat(): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = getOrCreateSessionId();
    setSessionId(id);

    fetchHistory(WORKER_URL, id)
      .then((history) => setMessages(history))
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load history.');
      });
  }, []);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed || !sessionId || isSending) return;

    setInput('');
    setIsSending(true);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, timestamp: Date.now() },
    ]);
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true },
    ]);

    try {
      await streamChatMessage(WORKER_URL, sessionId, trimmed, (event) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;

          const updated: DisplayMessage = { ...last };
          if (event.type === 'token') {
            updated.content = updated.content + event.value;
          } else if (event.type === 'sources') {
            updated.sources = event.value;
          } else if (event.type === 'done') {
            updated.isStreaming = false;
          } else if (event.type === 'error') {
            updated.error = event.value;
            updated.isStreaming = false;
          }
          return [...prev.slice(0, -1), updated];
        });
      });
    } catch (err) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const updated: DisplayMessage = {
          ...last,
          error: err instanceof Error ? err.message : 'Something went wrong.',
          isStreaming: false,
        };
        return [...prev.slice(0, -1), updated];
      });
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <h1>Cloudflare docs assistant</h1>
        <p>Ask about Agents, Workers AI, or Durable Objects.</p>
      </div>

      {loadError && (
        <div className="chat-error">Couldn&apos;t load history: {loadError}</div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && !loadError && (
          <div className="chat-empty">Ask a question to get started.</div>
        )}
        {messages.map((message, i) => (
          <div key={i} className={`chat-message chat-message--${message.role}`}>
            <div className="chat-message-content">
              {message.content}
              {message.isStreaming && <span className="chat-cursor" aria-hidden="true" />}
            </div>
            {message.error && <div className="chat-message-error">{message.error}</div>}
            {message.sources && message.sources.length > 0 && (
              <div className="chat-sources">
                <span className="chat-sources-label">Sources:</span>
                {message.sources.map((source) => (
                  <a
                    key={source.id}
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="chat-source-link"
                  >
                    {source.sourceTitle}
                  </a>
                ))}
              </div>
            )}
            {message.sources && message.sources.length === 0 && (
              <div className="chat-sources chat-sources--none">
                No matching documentation found for this question.
              </div>
            )}
          </div>
        ))}
        <div ref={scrollAnchorRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          rows={2}
          disabled={!sessionId || isSending}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!sessionId || isSending || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
