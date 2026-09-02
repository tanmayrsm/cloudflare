import { Hono } from 'hono';
import type { Env } from '../types';

export const chatRoutes = new Hono<{ Bindings: Env }>();

function getSessionStub(env: Env, sessionId: string): DurableObjectStub {
  const id = env.CHAT_SESSION.idFromName(sessionId);
  return env.CHAT_SESSION.get(id);
}

chatRoutes.get('/session/:id/history', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getSessionStub(c.env, sessionId);
  const url = new URL(c.req.url);
  url.pathname = '/history';
  return stub.fetch(url.toString(), { method: 'GET' });
});

chatRoutes.post('/session/:id/message', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getSessionStub(c.env, sessionId);
  const url = new URL(c.req.url);
  url.pathname = '/message';
  return stub.fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  });
});
