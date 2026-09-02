import { Hono } from 'hono';
import type { Env } from './types';
import { chatRoutes } from './routes/chat';

export { ChatSession } from './agent/chat-session';

const app = new Hono<{ Bindings: Env }>();

/**
 * Hand-rolled CORS middleware, applied AFTER downstream handlers run.
 *
 * Both routes in chatRoutes return a raw Response straight from
 * stub.fetch() rather than a Hono response helper - setting headers via
 * c.header() before next() gets silently discarded when a handler replaces
 * c.res with its own Response object. Setting headers on c.res after
 * next() resolves works regardless of how the response was built.
 */
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    const res = new Response(null, { status: 204 });
    res.headers.set('Access-Control-Allow-Origin', c.env.ALLOWED_ORIGIN);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return res;
  }

  await next();

  /**
   * Rebuild the response rather than mutate c.res.headers in place.
   * The /message route returns a Response with a streaming SSE body -
   * in-place header mutation on an already-returned streaming Response
   * is not reliably guaranteed to attach. Explicitly wrapping the same
   * body stream in a fresh Response with fresh Headers sidesteps that
   * ambiguity entirely - passing an existing ReadableStream into a new
   * Response does not consume or restart it, it just re-labels the
   * envelope around the same bytes.
   */
  const headers = new Headers(c.res.headers);
  headers.set('Access-Control-Allow-Origin', c.env.ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  c.res = new Response(c.res.body, {
    status: c.res.status,
    headers,
  });
});

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api', chatRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
