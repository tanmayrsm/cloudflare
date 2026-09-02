import { Hono } from 'hono';
import type { Env } from './types';
import { chatRoutes } from './routes/chat';

export { ChatSession } from './agent/chat-session';

const app = new Hono<{ Bindings: Env }>();

/**
 * Hand-rolled CORS middleware instead of the `hono/cors` helper: that
 * helper's dynamic-origin callback receives an untyped Context, which
 * would force an unsafe `any` read of `c.env.ALLOWED_ORIGIN`. Reading it
 * here keeps the binding fully typed end to end.
 */
app.use('*', async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN;
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST');
  c.header('Access-Control-Allow-Headers', 'Content-Type');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api', chatRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
