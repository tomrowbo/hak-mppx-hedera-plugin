/**
 * Tier 2: Integration tests — full end-to-end locally.
 *
 * Real hederaSession() client → real mppx HTTP server → real session verify.
 * Only external endpoints are mocked (Hedera chain responses via DI).
 *
 * The client's approve → open → voucher → close flow runs for real,
 * just with mocked chain responses so no actual on-chain calls happen.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Mppx } from 'mppx/server';
import { Challenge, Credential } from 'mppx';
import { session } from 'mppx-hedera/server';
import { hederaSession } from 'mppx-hedera/client';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { zeroAddress } from 'viem';
import {
  hederaTestnet,
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
  VOUCHER_TYPES,
} from 'mppx-hedera';
import http from 'http';

// ── Test account ─────────────────────────────────────────────────
const TEST_KEY = generatePrivateKey();
const TEST_ACCOUNT = privateKeyToAccount(TEST_KEY);
const RECIPIENT = TEST_ACCOUNT.address;
const TOKEN = '0x0000000000000000000000000000000000001549' as `0x${string}`;
const ESCROW = '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE' as `0x${string}`;
const SERVER_ID = 'integration-test.local';
const SECRET_KEY = 'integration-test-secret-key-32chars-min!!';

// Deterministic channelId that the mock readContract(computeChannelId) returns
const MOCK_CHANNEL_ID = '0x' + 'ab'.repeat(32) as `0x${string}`;

// ── Mock chain clients for SERVER side (session verify uses DI) ──
function createServerMocks() {
  return {
    publicClient: {
      readContract: vi.fn().mockImplementation(async ({ functionName }: any) => {
        if (functionName === 'getChannel') {
          return {
            finalized: false, closeRequestedAt: 0n,
            payer: TEST_ACCOUNT.address, payee: RECIPIENT,
            token: TOKEN, authorizedSigner: zeroAddress,
            deposit: 1000000n, settled: 0n,
          };
        }
        if (functionName === 'computeChannelId') {
          return MOCK_CHANNEL_ID;
        }
        return null;
      }),
      verifyTypedData: vi.fn().mockResolvedValue(true),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    },
    walletClient: {
      writeContract: vi.fn().mockResolvedValue('0x' + 'cc'.repeat(32)),
      account: TEST_ACCOUNT,
    },
  };
}

// ── Mock chain clients for CLIENT side (hederaSession uses getClient/getPublicClient DI) ──
function createClientMocks() {
  const mockWalletClient = {
    writeContract: vi.fn().mockResolvedValue('0x' + 'dd'.repeat(32)),
    signTypedData: vi.fn().mockImplementation(async ({ message }: any) => {
      // Use real signing — it's just crypto, no network
      const { createWalletClient, http: viemHttp } = await import('viem');
      const real = createWalletClient({ account: TEST_ACCOUNT, chain: hederaTestnet, transport: viemHttp('http://localhost:1') });
      return real.signTypedData({
        account: TEST_ACCOUNT,
        domain: {
          name: VOUCHER_DOMAIN_NAME,
          version: VOUCHER_DOMAIN_VERSION,
          chainId: 296,
          verifyingContract: ESCROW,
        },
        types: VOUCHER_TYPES,
        primaryType: 'Voucher',
        message,
      });
    }),
    account: TEST_ACCOUNT,
    chain: hederaTestnet,
  };

  const mockPublicClient = {
    readContract: vi.fn().mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'allowance') return 0n; // force approve
      if (functionName === 'computeChannelId') return MOCK_CHANNEL_ID;
      return null;
    }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
  };

  return { walletClient: mockWalletClient, publicClient: mockPublicClient };
}

// ── Local mppx HTTP server ───────────────────────────────────────
let server: http.Server;
let baseUrl: string;
let serverMocks: ReturnType<typeof createServerMocks>;

async function setupServer() {
  serverMocks = createServerMocks();

  const sessionHandler = session({
    account: TEST_ACCOUNT,
    recipient: RECIPIENT,
    escrowContract: ESCROW,
    currency: TOKEN,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: true,
    getClients: () => serverMocks as any,
  });

  const mppx = Mppx.create({
    methods: [sessionHandler],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  const route = (mppx as any).session({
    amount: '0.001',
    currency: TOKEN,
    decimals: 6,
    unitType: 'request',
    recipient: RECIPIENT,
    suggestedDeposit: '0.01',
    escrowContract: ESCROW,
  });

  server = http.createServer(async (req, res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    const request = new Request(`${baseUrl}${req.url}`, { method: req.method, headers });
    const result = await route(request);

    if (result.status === 402) {
      const challenge = result.challenge;
      for (const [k, v] of challenge.headers.entries()) res.setHeader(k, v);
      res.writeHead(402);
      res.end(await challenge.text());
    } else if (result.status === 200) {
      const response = result.withReceipt(new Response('{"data":"ok"}'));
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.writeHead(200);
      res.end('{"data":"ok"}');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
}

// ── Create a real hederaSession client with mocked chain ─────────
function createTestClient() {
  const clientMocks = createClientMocks();

  return hederaSession({
    account: TEST_ACCOUNT,
    deposit: '0.01',
    escrowContract: ESCROW,
    getClient: () => clientMocks.walletClient as any,
    getPublicClient: () => clientMocks.publicClient as any,
  });
}

// ── Helper: decode credential payload ────────────────────────────
function decodeCredential(serialized: string) {
  const b64 = serialized.replace('Payment ', '');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('integration: full local E2E with mocked chain', () => {
  beforeAll(async () => {
    await setupServer();
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    serverMocks = createServerMocks();
  });

  it('402 challenge has correct method and intent', async () => {
    const res = await fetch(`${baseUrl}/session`);
    expect(res.status).toBe(402);
    const challenge = Challenge.fromResponse(res);
    expect(challenge.method).toBe('hedera');
    expect(challenge.intent).toBe('session');
  });

  it('real hederaSession client opens channel via mppx server', async () => {
    const client = createTestClient();

    // Get challenge from real mppx HTTP server
    const res = await fetch(`${baseUrl}/session`);
    expect(res.status).toBe(402);
    const challenge = Challenge.fromResponse(res);

    // Real hederaSession() runs: check allowance → approve → open → sign voucher
    const credential = await client.createCredential({ challenge });
    expect(credential).toBeTruthy();
    expect(credential.startsWith('Payment ')).toBe(true);

    // Send credential to real mppx HTTP server
    const openRes = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: credential },
    });
    expect(openRes.status).toBe(200);
  });

  it('voucher after open succeeds (real client, real server)', async () => {
    const client = createTestClient();

    // Open
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const openCred = await client.createCredential({ challenge: ch1 });
    const openRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: openCred } });
    expect(openRes.status).toBe(200);

    // Voucher — same client, maintains channel state
    const res2 = await fetch(`${baseUrl}/session`);
    const ch2 = Challenge.fromResponse(res2);
    const voucherCred = await client.createCredential({ challenge: ch2 });
    const voucherRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: voucherCred } });
    expect(voucherRes.status).toBe(200);
  });

  it('3 consecutive vouchers on same channel', async () => {
    const client = createTestClient();

    // Open
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const openCred = await client.createCredential({ challenge: ch1 });
    await fetch(`${baseUrl}/session`, { headers: { Authorization: openCred } });

    // 3 vouchers
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/session`);
      const ch = Challenge.fromResponse(res);
      const cred = await client.createCredential({ challenge: ch });
      const result = await fetch(`${baseUrl}/session`, { headers: { Authorization: cred } });
      expect(result.status).toBe(200);
    }
  });

  it('close settles channel and calls writeContract', async () => {
    const client = createTestClient();

    // Open
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const openCred = await client.createCredential({ challenge: ch1 });
    await fetch(`${baseUrl}/session`, { headers: { Authorization: openCred } });

    // Extract channelId
    const parsed = decodeCredential(openCred);
    const channelId = parsed.payload.channelId;
    const cumulativeAmount = BigInt(parsed.payload.cumulativeAmount);

    // Build close credential (client doesn't have a close method, so build manually)
    const { createWalletClient, http: viemHttp } = await import('viem');
    const walletClient = createWalletClient({ account: TEST_ACCOUNT, chain: hederaTestnet, transport: viemHttp('http://localhost:1') });
    const closeSig = await walletClient.signTypedData({
      account: TEST_ACCOUNT,
      domain: { name: VOUCHER_DOMAIN_NAME, version: VOUCHER_DOMAIN_VERSION, chainId: 296, verifyingContract: ESCROW },
      types: VOUCHER_TYPES,
      primaryType: 'Voucher',
      message: { channelId, cumulativeAmount },
    });

    serverMocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

    const closeRes1 = await fetch(`${baseUrl}/session`);
    const closeCh = Challenge.fromResponse(closeRes1);
    const closeCred = Credential.from({
      challenge: closeCh,
      payload: { action: 'close', channelId, cumulativeAmount: cumulativeAmount.toString(), signature: closeSig },
    });

    const closeRes = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: Credential.serialize(closeCred) },
    });
    expect(closeRes.status).toBe(200);
    expect(serverMocks.walletClient.writeContract).toHaveBeenCalled();
  });

  it('full lifecycle: open → fetch × 3 → close → post-close rejected', async () => {
    const client = createTestClient();

    // Open
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const openCred = await client.createCredential({ challenge: ch1 });
    const openRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: openCred } });
    expect(openRes.status).toBe(200);

    // 3 vouchers
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/session`);
      const ch = Challenge.fromResponse(res);
      const cred = await client.createCredential({ challenge: ch });
      const result = await fetch(`${baseUrl}/session`, { headers: { Authorization: cred } });
      expect(result.status).toBe(200);
    }

    // Close
    const parsed = decodeCredential(openCred);
    const channelId = parsed.payload.channelId;
    const tickAmount = BigInt(ch1.request.amount);
    const finalCum = tickAmount * 4n; // 1 open + 3 vouchers

    const { createWalletClient, http: viemHttp } = await import('viem');
    const walletClient = createWalletClient({ account: TEST_ACCOUNT, chain: hederaTestnet, transport: viemHttp('http://localhost:1') });
    const closeSig = await walletClient.signTypedData({
      account: TEST_ACCOUNT,
      domain: { name: VOUCHER_DOMAIN_NAME, version: VOUCHER_DOMAIN_VERSION, chainId: 296, verifyingContract: ESCROW },
      types: VOUCHER_TYPES,
      primaryType: 'Voucher',
      message: { channelId, cumulativeAmount: finalCum },
    });

    serverMocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

    const closeRes1 = await fetch(`${baseUrl}/session`);
    const closeCh = Challenge.fromResponse(closeRes1);
    const closeCred = Credential.from({
      challenge: closeCh,
      payload: { action: 'close', channelId, cumulativeAmount: finalCum.toString(), signature: closeSig },
    });
    const closeRes = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: Credential.serialize(closeCred) },
    });
    expect(closeRes.status).toBe(200);

    // Post-close: voucher on finalized channel → 402
    const postRes = await fetch(`${baseUrl}/session`);
    const postCh = Challenge.fromResponse(postRes);
    const postCred = await client.createCredential({ challenge: postCh });
    const postResult = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: postCred },
    });
    expect(postResult.status).toBe(402);
  });
});
