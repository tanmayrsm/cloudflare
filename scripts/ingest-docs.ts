/**
 * One-time (or re-run-as-needed) ingestion script: fetches Cloudflare's own
 * Agents/Workers AI/Durable Objects documentation pages, chunks them,
 * embeds each chunk via Workers AI, and writes the result to
 * src/data/doc-embeddings.json, which the Worker imports directly as a
 * bundled asset.
 *
 * Run locally with: npm run ingest
 *
 * Uses wrangler's getPlatformProxy() to get real Workers AI binding
 * access from a plain Node script - this is Cloudflare's documented
 * mechanism for exactly this use case.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { convert as htmlToText } from 'html-to-text';
import { embedBatch } from '../src/lib/embeddings';
import type { Env } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/data/doc-embeddings.json');

const DOC_SOURCES: { url: string; title: string }[] = [
  {
    url: 'https://developers.cloudflare.com/agents/',
    title: 'Cloudflare Agents - Overview',
  },
  {
    url: 'https://developers.cloudflare.com/durable-objects/',
    title: 'Durable Objects - Overview',
  },
  {
    url: 'https://developers.cloudflare.com/workers-ai/',
    title: 'Workers AI - Overview',
  },
  {
    url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/',
    title: 'Workers AI - Llama 3.3 model reference',
  },
];

const CHUNK_TARGET_CHARS = 800;

interface Chunk {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
}

interface DocEmbedding extends Chunk {
  id: string;
  embedding: number[];
}

async function fetchDocText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  });
}

/**
 * Merges paragraphs into chunks up to roughly CHUNK_TARGET_CHARS, rather
 * than splitting mid-paragraph. Simple and dependency-free; a production
 * pipeline handling many docs would likely use a token-aware splitter
 * instead of a character-count heuristic.
 */
function chunkText(text: string, sourceUrl: string, sourceTitle: string): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);

  const chunks: Chunk[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > CHUNK_TARGET_CHARS && current.length > 0) {
      chunks.push({ text: current.trim(), sourceUrl, sourceTitle });
      current = '';
    }
    current += (current ? '\n\n' : '') + paragraph;
  }
  if (current.trim().length > 0) {
    chunks.push({ text: current.trim(), sourceUrl, sourceTitle });
  }
  return chunks;
}

async function main(): Promise<void> {
  console.warn(`Fetching and chunking ${DOC_SOURCES.length} doc pages...`);

  const allChunks: Chunk[] = [];
  for (const source of DOC_SOURCES) {
    const text = await fetchDocText(source.url);
    const chunks = chunkText(text, source.url, source.title);
    allChunks.push(...chunks);
    console.warn(`  ${source.title}: ${chunks.length} chunks`);
  }
  console.warn(`Total chunks: ${allChunks.length}`);

  const { env, dispose } = await getPlatformProxy<Env>();
  const output: DocEmbedding[] = [];

  try {
    const BATCH_SIZE = 20;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedBatch(
        env,
        batch.map((c) => c.text),
      );

      batch.forEach((chunk, j) => {
        const embedding = vectors[j];
        if (!embedding) return;
        output.push({ id: `chunk-${i + j}`, embedding, ...chunk });
      });
      console.warn(`  Embedded batch ${i / BATCH_SIZE + 1} (${batch.length} chunks)`);
    }

    await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.warn(`Wrote ${output.length} embedded chunks to ${OUTPUT_PATH}`);
  } finally {
    await dispose();
  }
}

main().catch((err: unknown) => {
  console.error('Ingestion failed:', err);
  process.exitCode = 1;
});
