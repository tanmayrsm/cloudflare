/**
 * Plain Vitest config, not the Workers-specific test pool.
 *
 * The current test suite (guardrails, cosine-similarity) covers pure
 * functions that never touch env.AI or any other binding, so they don't
 * need a real Miniflare/workerd runtime spun up at all - that would only
 * add a hard dependency on a real, authenticated Cloudflare session for
 * tests that have no reason to need one.
 *
 * If tests are added later for binding-dependent code (retrieval.ts,
 * chat-session.ts), those specifically would need
 * @cloudflare/vitest-pool-workers and either a real Cloudflare account
 * or an explicit mock for env.AI - a different, heavier test setup than
 * what pure-logic unit tests require.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
