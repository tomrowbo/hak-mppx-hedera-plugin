import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sessionStore from '../src/session-store.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Encode a fake credential payload as base64url
const fakePayload = {
  payload: { channelId: '0x000000000000000000000000000000000000000000000000000000000000abcd', cumulativeAmount: '5000' },
};
const fakeCredB64 = Buffer.from(JSON.stringify(fakePayload)).toString('base64url');
const fakeCredential = `Payment ${fakeCredB64}`;
const ESCROW = '0x000000000000000000000000000000000000CAFE';

const mockCreateCredential = vi.fn(async () => fakeCredential);

vi.mock('../src/bridge.js', () => ({
  contextToViemAccount: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111',
    signTypedData: vi.fn(async () => '0xdeadbeef'),
    type: 'local',
  })),
  resolveNetwork: vi.fn(() => 'testnet'),
  resolveChain: vi.fn(() => ({
    id: 296,
    name: 'Hedera Testnet',
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 8 },
    rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
  })),
}));

vi.mock('mppx-hedera/client', () => ({
  hederaSession: vi.fn(() => ({
    createCredential: mockCreateCredential,
  })),
}));

const mockFromResponse = vi.fn(() => ({
  method: 'hedera',
  intent: 'session',
  request: {
    amount: '100',
    currency: '0.0.5449',
    methodDetails: { escrowContract: ESCROW },
  },
}));

const mockCredentialFrom = vi.fn(() => ({ challenge: {}, payload: {} }));
const mockCredentialSerialize = vi.fn(() => 'Payment eyJjbG9zZSI6dHJ1ZX0');

const mockCredentialDeserialize = vi.fn((value: string) => {
  const b64 = value.replace('Payment ', '');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
});

vi.mock('mppx', () => ({
  Challenge: {
    fromResponse: (...args: any[]) => mockFromResponse(...args),
  },
  Credential: {
    from: (...args: any[]) => mockCredentialFrom(...args),
    serialize: (...args: any[]) => mockCredentialSerialize(...args),
    deserialize: (...args: any[]) => mockCredentialDeserialize(...args),
  },
}));

vi.mock('mppx-hedera', () => ({
  VOUCHER_DOMAIN_NAME: 'MppxEscrow',
  VOUCHER_DOMAIN_VERSION: '1',
  VOUCHER_TYPES: {
    Voucher: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint256' },
    ],
  },
  hederaTestnet: {
    id: 296,
    name: 'Hedera Testnet',
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 8 },
    rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
  },
  hederaMainnet: {
    id: 295,
    name: 'Hedera Mainnet',
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 8 },
    rpcUrls: { default: { http: ['https://mainnet.hashio.io/api'] } },
  },
}));

// Mock viem's createWalletClient to avoid real network calls
vi.mock('viem', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      signTypedData: vi.fn(async () => '0xdeadbeefdeadbeefdeadbeef'),
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient: any = {
  operatorAccountKey: { toStringRaw: () => 'ab'.repeat(32) },
  operatorAccountId: { toString: () => '0.0.12345' },
};

const context = { network: 'testnet', privateKey: '0x' + 'ab'.repeat(32) };
const TEST_URL = 'https://api.example.com';

function seedSession() {
  const handler = { createCredential: mockCreateCredential } as any;
  sessionStore.set(TEST_URL, {
    handler,
    url: TEST_URL,
    deposit: '0.10',
    network: 'testnet',
    openedAt: new Date().toISOString(),
    lastCredential: fakeCredential,
    escrowContract: ESCROW,
  });
}

function make402Response(): Response {
  return new Response(null, {
    status: 402,
    headers: { 'X-Payment': 'challenge-data' },
  });
}

function make200Response(body = 'settled'): Response {
  return new Response(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mppx_hedera_session_close_tool', () => {
  let execute: any;

  beforeEach(async () => {
    sessionStore.clear();
    vi.restoreAllMocks();

    mockFromResponse.mockReturnValue({
      method: 'hedera',
      intent: 'session',
      request: {
        amount: '100',
        currency: '0.0.5449',
        methodDetails: { escrowContract: ESCROW },
      },
    });
    mockCreateCredential.mockResolvedValue(fakeCredential);
    mockCredentialFrom.mockReturnValue({ challenge: {}, payload: {} });
    mockCredentialSerialize.mockReturnValue('Payment eyJjbG9zZSI6dHJ1ZX0');

    // Default fetch: close-challenge 402, close-send 200
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(make402Response())  // close challenge
        .mockResolvedValueOnce(make200Response()),  // close response
    );

    const mod = await import('../src/tools/session-close.js');
    execute = (params: any) => mod.default.execute(mockClient, context, params);
  });

  it('closes, settles, removes from store, returns success', async () => {
    seedSession();

    const result = await execute({ url: TEST_URL });

    expect(result.raw.status).toBe('closed');
    expect(result.raw.url).toBe(TEST_URL);
    expect(result.raw.settled).toBe('5000');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('no session returns error', async () => {
    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('No session open');
    expect(result.humanMessage).toContain('Nothing to close');
  });

  it('no lastCredential returns error and removes session', async () => {
    sessionStore.set(TEST_URL, {
      handler: { createCredential: mockCreateCredential } as any,
      url: TEST_URL,
      deposit: '0.10',
      network: 'testnet',
      openedAt: new Date().toISOString(),
      escrowContract: ESCROW,
    });

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('No credential to close with');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('no escrowContract in session returns error', async () => {
    sessionStore.set(TEST_URL, {
      handler: { createCredential: mockCreateCredential } as any,
      url: TEST_URL,
      deposit: '0.10',
      network: 'testnet',
      openedAt: new Date().toISOString(),
      lastCredential: fakeCredential,
      // no escrowContract
    });

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('Escrow contract not found');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('server rejects close (non-200) still removes session', async () => {
    seedSession();

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(make402Response())  // close challenge
        .mockResolvedValueOnce(new Response('error', { status: 500 })),  // server rejects
    );

    const result = await execute({ url: TEST_URL });

    expect(result.raw.status).toBe('close_attempted');
    expect(result.raw.serverStatus).toBe(500);
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('close challenge returns non-402 removes session', async () => {
    seedSession();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 })),
    );

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('Close challenge failed');
    expect(result.raw.status).toBe(200);
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('returns error when context.privateKey is missing', async () => {
    const mod = await import('../src/tools/session-close.js');
    const result = await mod.default.execute(mockClient, { network: 'testnet' }, {
      url: TEST_URL,
    });

    expect(result.raw.error).toBe('Missing privateKey');
  });

  it('throws when AgentMode.RETURN_BYTES is used', async () => {
    const mod = await import('../src/tools/session-close.js');
    const result = await mod.default.execute(mockClient, { ...context, mode: 'returnBytes' }, {
      url: TEST_URL,
    });

    expect(result.raw.error).toContain('RETURN_BYTES');
  });

  it('returns error when credential parsing fails', async () => {
    sessionStore.set(TEST_URL, {
      handler: { createCredential: mockCreateCredential } as any,
      url: TEST_URL,
      deposit: '0.10',
      network: 'testnet',
      openedAt: new Date().toISOString(),
      lastCredential: 'Payment !!!not-base64url!!!',
      escrowContract: ESCROW,
    });

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('Failed to parse credential');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('close challenge fetch failure removes session', async () => {
    seedSession();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('Network error')),
    );

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('Close failed');
    expect(result.raw.detail).toBe('Network error');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('signTypedData failure removes session', async () => {
    seedSession();

    const { createWalletClient } = await import('viem');
    vi.mocked(createWalletClient).mockReturnValueOnce({
      signTypedData: vi.fn().mockRejectedValueOnce(new Error('Signing failed')),
    } as any);

    const result = await execute({ url: TEST_URL });

    expect(result.raw.error).toBe('Close failed');
    expect(result.raw.detail).toBe('Signing failed');
    expect(sessionStore.has(TEST_URL)).toBe(false);
  });

  it('sessionStore.has(url) is false after close', async () => {
    seedSession();
    expect(sessionStore.has(TEST_URL)).toBe(true);

    await execute({ url: TEST_URL });

    expect(sessionStore.has(TEST_URL)).toBe(false);
    expect(sessionStore.get(TEST_URL)).toBeUndefined();
    expect(sessionStore.list().length).toBe(0);
  });
});
