# Design & Build Log

An account of the design decisions and verification process behind this
project, using Claude for AI-assisted development.

## 1. Scoping

The four required primitives (LLM, coordination, user input, memory) map
directly onto Cloudflare's own stack: Workers AI (Llama 3.3) for
generation, a Durable Object per chat session for memory and
orchestration, Hono for request routing, and a Next.js chat UI for input.
Chose a RAG-based documentation assistant as the concept, scoped to
Cloudflare's own Agents/Workers AI/Durable Objects docs - a domain where
correctness is externally verifiable by whoever reviews the submission,
and one that mirrors real production experience with LLM-powered product
features rather than a generic demo.

## 2. Architecture decisions

**Retrieval without Vectorize.** Vectorize requires the Workers Paid plan.
Given a corpus of a few dozen doc chunks, a full brute-force
cosine-similarity scan runs in sub-millisecond time - a dedicated vector
database would be solving a scale problem this project doesn't have.
Embeddings are pre-computed once at ingestion time and bundled into the
Worker as a static asset, keeping the entire stack on Cloudflare's free
tier. This is a deliberate choice given the corpus size, not a workaround;
Vectorize is the right call once brute-force search actually becomes the
bottleneck.

**Next.js adapter: `@opennextjs/cloudflare` over `vinext`.** Cloudflare's
own current guidance points to `vinext` as the newer default path, but it
remains in beta as of this writing. Chose the adapter that reached stable
1.0 GA in February 2026, prioritizing reproducibility for a reviewer
running this independently over adopting the newest tool.

**Two independently deployable projects**, not one monolith: `worker/`
(the agent - Hono, Durable Object, retrieval, guardrails) and `web/` (the
Next.js UI, calling the worker over HTTP/SSE). A clean API boundary
between interface and agent logic, consistent with a services-oriented
approach rather than tightly coupling UI and backend concerns.

**Guardrail design**, addressing failure modes rather than just the happy
path:
- *Anti-hallucination*: retrieved chunks below a similarity threshold are
  discarded; the system prompt explicitly instructs the model to say so
  rather than improvise from general knowledge when nothing relevant is
  found.
- *Prompt injection*: handled structurally, not with keyword filtering.
  Retrieved content and user input are delimited in the system prompt as
  reference data, never as instructions - keyword-based blocking is not a
  reliable defense against this class of attack and isn't treated as one.
- *Bounded memory*: conversation history is capped rather than sent to the
  model in full on every turn, avoiding both unbounded per-request cost
  and an eventual hard failure once history exceeds the model's context
  window.

## 3. Verification process

Every third-party dependency version was checked against its live
registry entry rather than assumed current, and every module was run
through the TypeScript compiler, ESLint, and a real build before being
considered complete. This surfaced several concrete issues, each resolved
before moving forward:

- An initially-selected pre-GA package version pulled in an unpublished
  experimental dependency; corrected by re-pinning to the verified current
  stable release.
- The corrected package's peer requirements cascaded into a Next.js major
  version upgrade, which in turn required migrating component files for
  React 19's updated JSX type-import behavior, and migrating the lint
  configuration to ESLint 9's flat-config format.

Each of these was caught by the verification step itself, not discovered
later - the practice of testing against real tooling, rather than trusting
memorized version numbers, is what surfaced them early.

## 4. Issues identified and resolved

**CORS headers dropped on the streaming response.**
*Symptom*: browser reported a CORS failure on the chat endpoint despite the
server logging a `200` response.
*Root cause*: middleware set response headers before calling the
downstream handler; the handler then returned an entirely new `Response`
object (from the Durable Object), silently discarding the headers set
earlier.
*Fix*: moved header assignment to after the downstream handler resolves,
and rebuilt the response explicitly rather than mutating headers in place,
since the streaming body made in-place mutation unreliable to guarantee.

**Workers AI authentication error in local development.**
*Symptom*: a `500` with an upstream authentication error, despite the same
account succeeding minutes earlier during doc ingestion.
*Root cause*: a stale cached Wrangler session token.
*Fix*: re-authenticated via `wrangler login`; noted as a known, general
Wrangler behavior rather than an application-level bug.

**Duplicated tokens in the streamed response.**
*Symptom*: every word in the assistant's reply appeared twice
consecutively.
*Root cause*: the frontend's streaming handler mutated a message object
directly inside a React state updater. React's Strict Mode deliberately
invokes state updaters twice in development specifically to surface
exactly this class of impurity - the mutation was being applied twice,
visibly doubling every token.
*Fix*: rewrote the updater to construct a new message object rather than
mutate the existing one, restoring the purity React's state model requires.

**Retrieval threshold rejecting valid matches.**
*Symptom*: on-topic questions returned "no information found."
*Root cause*: an initial, untuned similarity threshold set too high - short
queries score lower against long technical passages than intuition
suggests, even when clearly relevant.
*Fix*: instrumented retrieval to log every candidate's real similarity
score, then recalibrated the threshold against that data rather than
against another assumption. The logging was left in place to support
further tuning from production traffic rather than guesswork.
