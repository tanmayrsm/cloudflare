# Cloudflare Docs Agent

> Assignment prompt and build history: [PROMPT_HISTORY.md](./PROMPT_HISTORY.md)

An AI-powered chat assistant for Cloudflare's Agents, Workers AI, and Durable
Objects documentation. Built for the Cloudflare AI-powered application
assignment.

## What it does

You ask a question about Cloudflare's Agents platform; it retrieves the most
relevant chunks from a small pre-embedded corpus of Cloudflare's own docs,
grounds an LLM answer in that retrieved context, and streams the response
back token by token - with the sources it used shown alongside the answer.

## Architecture

```
User (static Next.js chat UI, Cloudflare Pages)
        |
        v
   Worker (Hono) -- routes to --> Durable Object (per session)
                                          |
                                          |-- retrieves relevant doc chunks
                                          |   (brute-force cosine similarity
                                          |    over a bundled, pre-embedded
                                          |    corpus - see below)
                                          |
                                          |-- calls Workers AI (Llama 3.3)
                                          |   with grounded context, streams
                                          |   tokens back via SSE
                                          |
                                          '-- persists conversation history
                                              (bounded to last 10 turns)
```

- **LLM**: Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Embeddings**: Workers AI, `@cf/baai/bge-base-en-v1.5`
- **Memory/state**: Durable Objects, one instance per conversation
- **Coordination**: Hono, routing requests to the correct Durable Object
- **Frontend**: Next.js (App Router), static export, served from Cloudflare Pages

## Deliberate decisions, and why

**No Vectorize.** Vectorize requires the Workers Paid plan. The doc corpus
here is a few dozen chunks - small enough that a brute-force cosine-similarity
scan runs in well under a millisecond, so a dedicated vector database would
be solving a scaling problem that doesn't exist yet. The pre-computed
embeddings are generated once by `scripts/ingest-docs.ts` and bundled into
the Worker as a static JSON asset (`src/data/doc-embeddings.json`), rather
than stored in any database at all.

**Static export for the frontend, not a Worker.** The chat UI has no server
components, API routes, or SSR need - it's a single client-rendered page
calling an external API. Cloudflare Workers' Free plan caps a Worker's
bundle at 3 MiB, and Next.js-via-`@opennextjs/cloudflare` deployments
commonly exceed that in practice, forcing an upgrade to the $5/month Paid
plan for a frontend with no actual server-side logic. A plain
`output: 'export'` static build sidesteps this entirely - Cloudflare Pages
serves static files unmetered on the free tier, with zero Worker involved
for the frontend at all.

Together, these two choices keep the entire project - backend and
frontend - on Cloudflare's completely free tier.

**Guardrails, not just a working happy path:**
- *Anti-hallucination*: retrieved chunks below a cosine-similarity
  threshold are discarded rather than forced into the prompt. If nothing
  relevant is found, the system prompt instructs the model to say so
  explicitly rather than improvise from general knowledge.
- *Prompt injection*: no keyword filter reliably blocks injection - that's
  an open problem, not something string matching solves. The real defense
  is structural: retrieved docs and user input are clearly delimited in the
  system prompt as reference data, never as instructions. A lightweight
  pattern-flagging layer exists for monitoring, but never blocks on its own.
- *Bounded memory*: conversation history is capped at the last 10 turns.
  Unbounded history is a cost problem (re-billed every turn) and eventually
  a hard failure once it exceeds the model's context window.

## Project structure

```
worker/   Hono API + Durable Object + retrieval + guardrails (the agent)
web/      Next.js chat UI (static export), calls the worker over HTTP/SSE
```

They're two independent, separately-deployable projects, not one monolith -
a clean API boundary between UI and agent logic.

## Running it locally (free tier, no Vectorize, no paid plan needed)

### Worker
```bash
cd worker
npm install
npx wrangler login          # one-time OAuth, needs a human click-through
npm run ingest               # fetches Cloudflare's docs, embeds them, writes doc-embeddings.json
npm run typecheck
npm run lint
npm run test
npm run dev                  # http://127.0.0.1:8787
```

### Web (in a second terminal, worker must be running)
```bash
cd web
npm install
npm run dev                  # http://localhost:3000
```

Open `http://localhost:3000` and ask a question.

## Deploying (also free tier)

### Worker
```bash
cd worker
npx wrangler deploy
```
This gives you a live URL like `docs-agent-worker.<your-subdomain>.workers.dev`.
Update `ALLOWED_ORIGIN` in `wrangler.toml` (or `npx wrangler secret put ALLOWED_ORIGIN`)
to your deployed frontend's URL once you have it, instead of `localhost:3000`.

### Web
```bash
cd web
# set NEXT_PUBLIC_WORKER_URL to your deployed worker's URL first
npm run deploy    # runs next build, then wrangler pages deploy out
```
This publishes the static build to Cloudflare Pages and gives you a live
URL. No Worker is involved in serving the frontend, so there's no bundle
size concern and no scenario that forces a paid plan.

**Cost, concretely:** both deploy commands above run entirely on
Cloudflare's Free plan - Workers (100K requests/day), Durable Objects, and
Workers AI (10,000 Neurons/day) all have usable free tiers, and static
Pages hosting is unmetered. The only way this project would ever cost
money is if you explicitly upgrade to the Workers Paid plan yourself -
nothing here requires or triggers that automatically.

## Testing

`worker/test/` covers the pure-logic pieces (guardrails, cosine similarity)
with plain Vitest - no Workers runtime needed, since neither touches a
binding. Testing the retrieval or Durable Object logic directly would need
`@cloudflare/vitest-pool-workers` plus either a real authenticated
Cloudflare account or an explicit mock for `env.AI` - a heavier setup that
wasn't necessary for what's covered so far.

## Honest limitations

- Chunking in `ingest-docs.ts` is paragraph-length-based, not token-aware -
  fine at this corpus size, would need a real tokenizer for anything larger.
- The relevance threshold (0.6) was tuned against real logged similarity
  scores during development, not a large labeled query/doc set.
- No rate limiting on the chat endpoint - fine for a take-home demo, a real
  deployment would want one.
