import type { Env, RetrievedChunk } from '../types';
import { embedText } from './embeddings';
import { cosineSimilarity } from './cosine-similarity';
import docEmbeddings from '../data/doc-embeddings.json';

/**
 * Below this cosine-similarity score, a match is treated as "not actually
 * relevant" rather than forced into the prompt. This is the core
 * anti-hallucination guardrail: if nothing in the docs is a good match,
 * the model should say so instead of confidently improvising an answer
 * from its own general knowledge.
 *
 * 0.6, not 0.75: short, generic queries ("tell me about agents") score
 * lower against long technical passages than intuition suggests, even
 * when clearly on-topic. 0.75 was rejecting real matches. This is still
 * an untuned starting point - see the console.warn below, which logs
 * every candidate's real score so it can be tuned from actual data
 * instead of another guess.
 */
export const RELEVANCE_THRESHOLD = 0.6;

const TOP_K = 4;

interface DocEmbedding {
  id: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  embedding: number[];
}

/**
 * Brute-force nearest-neighbor search over a small, static, pre-embedded
 * doc corpus (see scripts/ingest-docs.ts), bundled into the Worker at
 * build time rather than stored in a dedicated vector database.
 *
 * This is a deliberate scale-appropriate choice, not a placeholder: the
 * corpus here is a few dozen chunks, and a full O(n) cosine-similarity
 * scan over that many vectors runs in well under a millisecond. A vector
 * database earns its cost once brute-force search actually becomes the
 * bottleneck - reaching for one before that point is premature, not
 * "more correct."
 */
export async function retrieveRelevantChunks(
  env: Env,
  query: string,
): Promise<RetrievedChunk[]> {
  const corpus = docEmbeddings as DocEmbedding[];
  if (corpus.length === 0) return [];

  const queryVector = await embedText(env, query);

  const scored = corpus.map((doc) => ({
    id: doc.id,
    text: doc.text,
    sourceUrl: doc.sourceUrl,
    sourceTitle: doc.sourceTitle,
    score: cosineSimilarity(queryVector, doc.embedding),
  }));

  // Logs every candidate's real score, not just the ones that pass -
  // visible in `wrangler dev`'s terminal output. This is what actual
  // threshold tuning should be based on, not another guess.
  const topScores = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => `${c.score.toFixed(3)} - ${c.sourceTitle}`);
  console.warn(`Retrieval scores for "${query}":`, topScores);

  return scored
    .filter((chunk) => chunk.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
