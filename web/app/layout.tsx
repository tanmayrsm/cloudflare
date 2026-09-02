import type { Metadata } from 'next';
import type { JSX } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cloudflare Docs Agent',
  description:
    'An AI-powered assistant for Cloudflare Agents, Workers AI, and Durable Objects docs.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
