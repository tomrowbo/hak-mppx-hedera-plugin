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
  getOperatorId: vi.fn(() => '0.0.12345'),
  getPrivateKey: vi.fn(() => '0xab'.repeat(32)),
}));

const mockCreateCredential = vi.fn(async () => 'Payment eyJmYWtlIjoidHJ1ZSJ9');

vi.mock('mppx-hedera/client', () => ({
  hederaSession: vi.fn(() => ({
    createCredential: mockCreateCredential,
  })),
}));

const mockFromResponse = vi.fn(() => ({
  method: 'hedera',
  intent: 'session',
  request: { amount: '1000', currency: '0.0.5449', methodDetails: { escrowContract: '0x000000000000000000000000000000000000CAFE' } },
}));

vi.mock('mppx', () => ({
  Challenge: {
    fromResponse: (...args: any[]) => mockFromResponse(...args),
  },
  Credential: {
    from: vi.fn(() => ({ challenge: {}, payload: {} })),
    serialize: vi.fn(() => 'Payment eyJmYWtlIjoiY2xvc2UifQ'),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient: any = {
  operatorAccountKey: { toStringRaw: () => 'ab'.repeat(32) },
  operatorAccountId: { toString: () => '0.0.12345' },
};

const context = { network: 'testnet', privateKey: '0x' + 'ab'.repeat(32) };
const TEST_URL = 'https://api.example.com';

function make402Response(): Response {
  return new Response(null, {
    status: 402,
    headers: { 'X-Payment': 'challenge-data' },
  });
}

function make200Response(body = 'ok'): Response {
  return new Response(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mppx_hedera_session_open_tool', () => {
  let execute: any;

  beforeEach(async () => {
    sessionStore.clear();
    vi.restoreAllMocks();

    // Re-setup default mocks after restoreAllMocks
    mockFromResponse.mockReturnValue({
      method: 'hedera',
      intent: 'session',
      request: { amount: '1000', currency: '0.0.5449', methodDetails: { escrowContract: '0x000000000000000000000000000000000000CAFE' } },
    });
    mockCreateCredential.mockResolvedValue('Payment eyJmYWtlIjoidHJ1ZSJ9');

    // Default fetch: first call returns 402, second returns 200
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(make402Response())
        .mockResolvedValueOnce(make200Response()),
    );

    // Dynamic import to pick up mocks
    const mod = await import('../src/tools/session-open.js');
    execute = (params: any) => mod.default.execute(mockClient, context, params);
  });

  it('402 + session challenge opens channel, stores session, returns success', async () => {
    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.status).toBe('open');
    expect(result.raw.url).toBe(TEST_URL);
    expect(result.raw.deposit).toBe('0.10');
    expect(result.raw.network).toBe('testnet');
    expect(sessionStore.has(TEST_URL)).toBe(true);
  });

  it('non-402 response returns error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 })),
    );

    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.error).toBe('Server did not return 402');
    expect(result.raw.status).toBe(200);
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('challenge intent !== session returns error suggesting charge tool', async () => {
    mockFromResponse.mockReturnValue({
      method: 'hedera',
      intent: 'charge',
      request: { amount: '1000' },
    });

    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.error).toBe('Not a session intent');
    expect(result.raw.intent).toBe('charge');
    expect(result.humanMessage).toContain('mppx_hedera_charge_fetch_tool');
  });

  it('session already open for URL returns error', async () => {
    // Seed a session
    sessionStore.set(TEST_URL, {
      handler: {} as any,
      url: TEST_URL,
      deposit: '0.10',
      network: 'testnet',
      openedAt: new Date().toISOString(),
    });

    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.error).toBe('Session already open');
    expect(result.humanMessage).toContain('already open');
  });

  it('channel open (createCredential) fails returns error', async () => {
    mockCreateCredential.mockRejectedValueOnce(new Error('Insufficient USDC balance'));

    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.error).toBe('Failed to open channel');
    expect(result.raw.detail).toBe('Insufficient USDC balance');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('server rejects open credential (non-200) returns error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(make402Response())
        .mockResolvedValueOnce(new Response('Forbidden', { status: 403 })),
    );

    const result = await execute({ url: TEST_URL, deposit: '0.10' });

    expect(result.raw.error).toBe('Server rejected open');
    expect(result.raw.status).toBe(403);
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('returns error when context.privateKey is missing', async () => {
    const mod = await import('../src/tools/session-open.js');
    const result = await mod.default.execute(mockClient, { network: 'testnet' }, {
      url: TEST_URL,
      deposit: '0.10',
    });

    expect(result.raw.error).toBe('Missing privateKey');
  });

  it('throws when AgentMode.RETURN_BYTES is used', async () => {
    const mod = await import('../src/tools/session-open.js');
    const result = await mod.default.execute(mockClient, { ...context, mode: 'returnBytes' }, {
      url: TEST_URL,
      deposit: '0.10',
    });

    expect(result.raw.error).toContain('RETURN_BYTES');
  });

  it('session stored with correct url, deposit, network, openedAt', async () => {
    const before = new Date().toISOString();
    await execute({ url: TEST_URL, deposit: '0.50' });
    const after = new Date().toISOString();

    const entry = sessionStore.get(TEST_URL);
    expect(entry).toBeDefined();
    expect(entry!.url).toBe(TEST_URL);
    expect(entry!.deposit).toBe('0.50');
    expect(entry!.network).toBe('testnet');
    expect(entry!.openedAt >= before).toBe(true);
    expect(entry!.openedAt <= after).toBe(true);
    expect(entry!.lastCredential).toBe('Payment eyJmYWtlIjoidHJ1ZSJ9');
    expect(entry!.escrowContract).toBeDefined();
  });
});
