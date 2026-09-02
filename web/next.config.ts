import type { NextConfig } from 'next';

/**
 * Static export, not the OpenNext Cloudflare adapter.
 *
 * This app has no server components, no API routes, and no SSR need -
 * it's a single client-rendered chat page calling an external API. A
 * Worker-based deployment (via OpenNext) would work, but Cloudflare
 * Workers' Free plan caps a Worker's bundle at 3 MiB, and Next.js
 * bundles commonly exceed that - several real deployment writeups
 * confirm this forces an upgrade to the $5/month Paid plan just to host
 * a frontend that has no actual server-side logic. Static export sidesteps
 * that entirely: Cloudflare Pages serves static files unmetered on the
 * free tier, with no Worker involved for the frontend at all.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
};

export default nextConfig;
