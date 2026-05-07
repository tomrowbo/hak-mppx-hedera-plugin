import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sessionStore from '../src/session-store.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/bridge.js', () => ({
  contextToViemAccount: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111',
  })),
  resolveNetwork: vi.fn(() => 'testnet'),
  resolveChain: vi.fn(() => ({ id: 296, name: 'Hedera Testnet' })),
}));

const mockCreateCredential = vi.fn(async () => 'Payment eyJmYWtlIjoidHJ1ZSJ9');

const mockFromResponse = vi.fn(() => ({
  method: 'hedera',
  intent: 'session',
  request: { amount: '100', currency: '0.0.5449' },
}));

vi.mock('mppx', () => ({
  Challenge: {
    fromResponse: (...args: any[]) => mockFromResponse(...args),
  },
}));

vi.mock('mppx-hedera/client', () => ({
  hederaSession: vi.fn(() => ({
    createCredential: mockCreateCredential,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient: any = {
  operatorAccountKey: { toStringRaw: () => 'ab'.repeat(32) },
  operatorAccountId: { toString: () => '0.0.12345' },
};

const context = { network: 'testnet', privateKey: '0x' + 'ab'.repeat(32) };
const TEST_URL = 'https://api.example.com/data';

function seedSession() {
  const handler = { createCredential: mockCreateCredential } as any;
  sessionStore.set(TEST_URL, {
    handler,
    url: TEST_URL,
    deposit: '0.10',
    network: 'testnet',
    openedAt: new Date().toISOString(),
  });
}

function make402Response(): Response {
  return new Response(null, {
    status: 402,
    headers: { 'X-Payment': 'challenge-data' },
  });
}

function make200Response(body = '{"result":"ok"}'): Response {
  return new Response(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mppx_hedera_session_fetch_tool', () => {
  let execute: any;

  beforeEach(async () => {
    sessionStore.clear();
    vi.restoreAllMocks();

    mockFromResponse.mockReturnValue({
      method: 'hedera',
      intent: 'session',
      request: { amount: '100', currency: '0.0.5449' },
    });
    mockCreateCredential.mockResolvedValue('Payment eyJmYWtlIjoidHJ1ZSJ9');

    // Default fetch: challenge 402, then paid 200
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(make402Response())
        .mockResolvedValueOnce(make200Response()),
    );

    const mod = await import('../src/tools/session-fetch.js');
    execute = (params: any) => mod.default.execute(mockClient, context, params);
  });

  it('existing session signs voucher and returns data', async () => {
    seedSession();

    const result = await execute({ url: TEST_URL, method: 'GET' });

    expect(result.raw.status).toBe(200);
    expect(result.raw.data).toBe('{"result":"ok"}');
    expect(result.raw.paid).toBe(true);
    expect(mockCreateCredential).toHaveBeenCalled();
  });

  it('no session returns error', async () => {
    // Do not seed session
    const result = await execute({ url: TEST_URL, method: 'GET' });

    expect(result.raw.error).toBe('No session open');
    expect(result.humanMessage).toContain('mppx_hedera_session_open_tool');
  });

  it('server returns non-402 returns data without payment', async () => {
    seedSession();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(make200Response('free data')),
    );

    const result = await execute({ url: TEST_URL, method: 'GET' });

    expect(result.raw.paid).toBe(false);
    expect(result.raw.data).toBe('free data');
    expect(result.raw.status).toBe(200);
  });

  it('voucher signing fails returns error suggesting close and reopen', async () => {
    seedSession();
    mockCreateCredential.mockRejectedValueOnce(new Error('Channel exhausted'));

    const result = await execute({ url: TEST_URL, method: 'GET' });

    expect(result.raw.error).toBe('Voucher signing failed');
    expect(result.raw.detail).toBe('Channel exhausted');
    expect(result.humanMessage).toContain('close');
  });

  it('POST with body works', async () => {
    seedSession();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make402Response())
      .mockResolvedValueOnce(make200Response('{"created":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await execute({
      url: TEST_URL,
      method: 'POST',
      body: '{"query":"hello"}',
    });

    expect(result.raw.status).toBe(200);
    expect(result.raw.paid).toBe(true);

    // Verify second fetch call used POST with body
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[1].method).toBe('POST');
    expect(secondCall[1].body).toBe('{"query":"hello"}');
    expect(secondCall[1].headers['Content-Type']).toBe('application/json');
  });

  it('throws when AgentMode.RETURN_BYTES is used', async () => {
    const mod = await import('../src/tools/session-fetch.js');
    const result = await mod.default.execute(mockClient, { ...context, mode: 'returnBytes' }, {
      url: TEST_URL,
      method: 'GET',
    });

    expect(result.raw.error).toContain('RETURN_BYTES');
  });

  it('multiple fetches work (3 consecutive calls)', async () => {
    seedSession();

    const fetchMock = vi.fn();
    // 3 rounds of challenge + response
    for (let i = 0; i < 3; i++) {
      fetchMock
        .mockResolvedValueOnce(make402Response())
        .mockResolvedValueOnce(make200Response(`{"call":${i}}`));
    }
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 3; i++) {
      const result = await execute({ url: TEST_URL, method: 'GET' });
      expect(result.raw.status).toBe(200);
      expect(result.raw.paid).toBe(true);
      expect(result.raw.data).toBe(`{"call":${i}}`);
    }

    expect(fetchMock).toHaveBeenCalledTimes(6); // 2 per round
  });
});
