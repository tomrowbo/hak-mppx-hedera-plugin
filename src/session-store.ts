/**
 * In-memory session state store.
 *
 * Tracks open payment channels so the agent can make multiple calls
 * (session-fetch) against the same channel opened by session-open.
 * Keyed by server URL.
 */

import type { hederaSession } from 'mppx-hedera/client';

export interface SessionEntry {
  /** The client session handler (maintains channel state internally) */
  handler: ReturnType<typeof hederaSession>;
  /** Server base URL */
  url: string;
  /** Deposit amount (human-readable) */
  deposit: string;
  /** Network used */
  network: 'testnet' | 'mainnet';
  /** Timestamp when opened */
  openedAt: string;
}

const sessions = new Map<string, SessionEntry>();

/** Store a session for a URL */
export function set(url: string, entry: SessionEntry): void {
  sessions.set(normalizeUrl(url), entry);
}

/** Get a session for a URL */
export function get(url: string): SessionEntry | undefined {
  return sessions.get(normalizeUrl(url));
}

/** Remove a session for a URL */
export function remove(url: string): boolean {
  return sessions.delete(normalizeUrl(url));
}

/** Check if a session exists for a URL */
export function has(url: string): boolean {
  return sessions.has(normalizeUrl(url));
}

/** List all active sessions */
export function list(): SessionEntry[] {
  return Array.from(sessions.values());
}

/** Clear all sessions */
export function clear(): void {
  sessions.clear();
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}
