import { describe, it, expect, beforeEach } from 'vitest';
import * as sessionStore from '../src/session-store.js';

/** Minimal session entry for testing */
function makeEntry(url: string, deposit = '0.10'): any {
  return {
    handler: { createCredential: async () => 'mock' },
    url,
    deposit,
    network: 'testnet' as const,
    openedAt: new Date().toISOString(),
  };
}

describe('session-store', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('set + get stores and retrieves a session', () => {
    const entry = makeEntry('https://api.example.com');
    sessionStore.set('https://api.example.com', entry);
    expect(sessionStore.get('https://api.example.com')).toBe(entry);
  });

  it('get returns undefined for unknown URL', () => {
    expect(sessionStore.get('https://unknown.example.com')).toBeUndefined();
  });

  it('has returns true for stored URL and false for unknown', () => {
    const entry = makeEntry('https://api.example.com');
    sessionStore.set('https://api.example.com', entry);

    expect(sessionStore.has('https://api.example.com')).toBe(true);
    expect(sessionStore.has('https://other.example.com')).toBe(false);
  });

  it('remove deletes a session and returns true', () => {
    const entry = makeEntry('https://api.example.com');
    sessionStore.set('https://api.example.com', entry);

    expect(sessionStore.remove('https://api.example.com')).toBe(true);
    expect(sessionStore.get('https://api.example.com')).toBeUndefined();
  });

  it('remove returns false for unknown URL', () => {
    expect(sessionStore.remove('https://unknown.example.com')).toBe(false);
  });

  it('list returns all stored sessions', () => {
    const entry1 = makeEntry('https://api1.example.com');
    const entry2 = makeEntry('https://api2.example.com');
    sessionStore.set('https://api1.example.com', entry1);
    sessionStore.set('https://api2.example.com', entry2);

    const all = sessionStore.list();
    expect(all).toHaveLength(2);
    expect(all).toContain(entry1);
    expect(all).toContain(entry2);
  });

  it('clear removes everything', () => {
    sessionStore.set('https://api1.example.com', makeEntry('https://api1.example.com'));
    sessionStore.set('https://api2.example.com', makeEntry('https://api2.example.com'));

    sessionStore.clear();
    expect(sessionStore.list()).toHaveLength(0);
  });

  it('normalizes URLs by stripping path components', () => {
    const entry = makeEntry('https://example.com');
    sessionStore.set('https://example.com/path/to/resource', entry);

    // Should be retrievable via the base URL (normalized to protocol://host)
    expect(sessionStore.get('https://example.com')).toBe(entry);
    expect(sessionStore.get('https://example.com/other/path')).toBe(entry);
    expect(sessionStore.has('https://example.com/anything')).toBe(true);
  });
});
