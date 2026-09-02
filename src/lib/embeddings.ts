import type { Env } from '../types';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

interface EmbeddingResponse {
  data: number[][];
}

/**
 * @cloudflare/workers-types does not give env.AI.run() a precise return
 * type for every model - for bge-base-en-v1.5 it resolves broadly enough
 * that TypeScript can't guarantee the shape at compile time. Rather than
 * assert past that gap (which would silently trust an external response),
 * we validate the shape at runtime and fail loudly if it's ever wrong.
 */
function assertEmbeddingResponse(value: unknown): asserts value is EmbeddingResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('data' in value) ||
    !Array.isArray((value as { data: unknown }).data)
  ) {
    throw new Error('Workers AI returned an unexpected shape for embedding response.');
  }
}

/**
 * Embeds a single piece of text via Workers AI and returns the vector.
 * Throws if the model returns an unexpected shape - callers should let
 * this propagate; a bad embedding should never silently become a bad
 * search result.
 */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const result: unknown = await env.AI.run(EMBEDDING_MODEL, { text: [text] });
  assertEmbeddingResponse(result);

  const vector = result.data[0];
  if (!vector) {
    throw new Error('Embedding model returned no vector for input text.');
  }
  return vector;
}

/**
 * Embeds a batch of texts in one call. Used by the ingestion script so we
 * don't make one Workers AI request per doc chunk.
 */
export async function embedBatch(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result: unknown = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  assertEmbeddingResponse(result);
  return result.data;
}
