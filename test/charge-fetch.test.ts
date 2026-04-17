import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Challenge } from 'mppx';

// Mock mppx-hedera/client charge function before importing the module under test
vi.mock('mppx-hedera/client', () => ({
  charge: vi.fn(() => ({
    createCredential: vi.fn(async () => 'Payment mockCredentialBase64'),
  })),
}));

import chargeFetchTool from '../src/tools/charge-fetch.js';
import { charge } from 'mppx-hedera/client';

const mockClient = {
  operatorAccountKey: { toStringRaw: () => 'ab'.repeat(32) },
  operatorAccountId: { toString: () => '0.0.12345' },
};

const context = { network: 'testnet', privateKey: '0x' + 'ab'.repeat(32) };

/**
 * Build a proper 402 response with a WWW-Authenticate: Payment header
 * that Challenge.fromResponse can parse.
 */
function mock402Response(amount = '50000') {
  const challenge = Challenge.from({
    id: 'test-challenge-id',
    realm: 'https://api.example.com',
    method: 'hedera',
    intent: 'charge',
    request: {
      amount,
      currency: '0x0000000000000000000000000000000000001549',
      decimals: 6,
      recipient: '0x0000000000000000000000000000000000001234',
    },
  });
  const headerValue = Challenge.serialize(challenge);
  const headers = new Headers();
  headers.set('WWW-Authenticate', headerValue);
  return new Response(null, { status: 402, headers });
}

function mock200Response(body = '{"result":"ok"}') {
  return new Response(body, { status: 200 });
}

function mockNon402Response(status = 200, body = '{"free":"data"}') {
  return new Response(body, { status });
}

describe('charge-fetch tool', () => {
  const originalFetch = globalThis.fetch;
  let tool: ReturnType<typeof chargeFetchTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = chargeFetchTool(context);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns data directly when response is not 402', async () => {
    globalThis.fetch = vi.fn(async () => mockNon402Response(200, '{"free":"data"}'));

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/data',
      method: 'GET',
      maxAmount: '100000',
    });

    expect(result.raw.status).toBe(200);
    expect(result.raw.data).toBe('{"free":"data"}');
    expect(result.humanMessage).toContain('no payment needed');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('pays and retries on 402, returning data', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mock402Response('50000');
      return mock200Response('{"paid":"content"}');
    });

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/premium',
      method: 'GET',
      maxAmount: '100000',
    });

    expect(result.raw.status).toBe(200);
    expect(result.raw.data).toBe('{"paid":"content"}');
    expect(result.raw.payment).toBeDefined();
    expect(result.raw.payment.amount).toBe('50000');
    expect(result.humanMessage).toContain('Paid');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns error without paying when amount exceeds maxAmount', async () => {
    globalThis.fetch = vi.fn(async () => mock402Response('200000'));

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/expensive',
      method: 'GET',
      maxAmount: '100000',
    });

    expect(result.raw.error).toBe('Amount exceeds budget');
    expect(result.raw.requested).toBe('200000');
    expect(result.humanMessage).toContain('too expensive');
    // charge should never have been called
    expect(charge).not.toHaveBeenCalled();
  });

  it('returns error when 402 challenge cannot be parsed', async () => {
    // Return a 402 with no WWW-Authenticate header — Challenge.fromResponse will throw
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 402 }));

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/broken',
      method: 'GET',
      maxAmount: '100000',
    });

    expect(result.raw.error).toBe('Failed to parse 402 challenge');
    expect(result.humanMessage).toContain('could not be parsed');
  });

  it('returns error when payment fails', async () => {
    globalThis.fetch = vi.fn(async () => mock402Response('50000'));

    // Make charge().createCredential throw
    vi.mocked(charge).mockReturnValueOnce({
      createCredential: vi.fn(async () => {
        throw new Error('Insufficient balance');
      }),
    } as any);

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/pay-fail',
      method: 'GET',
      maxAmount: '100000',
    });

    expect(result.raw.error).toBe('Payment failed');
    expect(result.raw.detail).toBe('Insufficient balance');
    expect(result.humanMessage).toContain('Failed to pay');
  });

  it('returns paid response even when retry returns non-200', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mock402Response('50000');
      return new Response('Server Error', { status: 500 });
    });

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/retry-fail',
      method: 'GET',
      maxAmount: '100000',
    });

    // The tool returns whatever the retry response is, including non-200
    expect(result.raw.status).toBe(500);
    expect(result.raw.data).toBe('Server Error');
    expect(result.raw.payment).toBeDefined();
  });

  it('POST passes body correctly in both initial and retry requests', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mock402Response('10000');
      return mock200Response('{"posted":"ok"}');
    });

    const result = await tool.execute(mockClient as any, context, {
      url: 'https://api.example.com/submit',
      method: 'POST',
      body: '{"input":"test"}',
      maxAmount: '100000',
    });

    expect(result.raw.status).toBe(200);

    // Verify the initial POST had the body
    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(firstCall[1]?.method).toBe('POST');
    expect(firstCall[1]?.body).toBe('{"input":"test"}');

    // Verify the retry POST also had the body
    const secondCall = vi.mocked(globalThis.fetch).mock.calls[1];
    expect(secondCall[1]?.method).toBe('POST');
    expect(secondCall[1]?.body).toBe('{"input":"test"}');
  });

  it('default maxAmount is 100000', () => {
    // The zod schema default should be '100000'
    const schema = tool.parameters;
    const parsed = schema.parse({ url: 'https://example.com' });
    expect(parsed.maxAmount).toBe('100000');
  });
});
