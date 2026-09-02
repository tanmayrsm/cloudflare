const SESSION_STORAGE_KEY = 'docs-agent-session-id';

/**
 * Returns the current session ID, creating and persisting a new one on
 * first visit. This is plain browser localStorage (not the Claude
 * artifact sandbox's storage API) - this is a real deployed Next.js app,
 * a completely different runtime with no such restriction.
 */
export function getOrCreateSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const fresh = crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  return fresh;
}
