/**
 * Tier 2: Integration tests — real mppx HTTP server, mocked chain via DI.
 *
 * Tests the session mppx flow through real HTTP. The server uses getClients DI
 * to mock chain interactions. The client signs with a real viem account (off-chain
 * only — no on-chain calls in the test).
 *
 * For the open action, we build the credential manually (since the client's
 * hederaSession would try to hit real chain for approve/open). The voucher
 * and close actions are purely off-chain (EIP-712 signing).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Mppx } from 'mppx/server';
import { Challenge, Credential } from 'mppx';
import { session } from 'mppx-hedera/server';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createWalletClient, http as viemHttp } from 'viem';
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
const TOKEN = '0x0000000000000000000000000000000000001549';
const ESCROW = '0x401b6dc30221823361E4876f5C502e37249D84C3';
const SERVER_ID = 'integration-test.local';
const SECRET_KEY = 'integration-test-secret-key-32chars-min!!';
const CHANNEL_ID = '0x' + '00'.repeat(31) + '01';

// ── Mock chain clients ───────────────────────────────────────────
let mocks: ReturnType<typeof createMocks>;

function createMocks() {
  return {
    publicClient: {
      readContract: vi.fn().mockResolvedValue({
        finalized: false, closeRequestedAt: 0n,
        payer: TEST_ACCOUNT.address, payee: RECIPIENT,
        token: TOKEN, authorizedSigner: zeroAddress,
        deposit: 1000000n, settled: 0n,
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

// ── EIP-712 voucher signer ───────────────────────────────────────
async function signVoucher(channelId: string, cumulativeAmount: bigint) {
  const walletClient = createWalletClient({
    account: TEST_ACCOUNT,
    chain: hederaTestnet,
    transport: viemHttp('https://localhost:1'), // won't be called — just for type
  });

  return walletClient.signTypedData({
    account: TEST_ACCOUNT,
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId: 296,
      verifyingContract: ESCROW as `0x${string}`,
    },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: { channelId: channelId as `0x${string}`, cumulativeAmount },
  });
}

// ── Local mppx HTTP server ───────────────────────────────────────
let server: http.Server;
let baseUrl: string;

async function setupServer() {
  mocks = createMocks();

  const sessionHandler = session({
    account: TEST_ACCOUNT,
    recipient: RECIPIENT,
    escrowContract: ESCROW as `0x${string}`,
    currency: TOKEN as `0x${string}`,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: true,
    getClients: () => mocks as any,
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

    const request = new Request(`${baseUrl}${req.url}`, {
      method: req.method,
      headers,
    });

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

describe('integration: session tools against local mppx server', () => {
  beforeAll(async () => {
    await setupServer();
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    mocks = createMocks();
  });

  it('402 challenge has method=hedera, intent=session', async () => {
    const res = await fetch(`${baseUrl}/session`);
    expect(res.status).toBe(402);
    const challenge = Challenge.fromResponse(res);
    expect(challenge.method).toBe('hedera');
    expect(challenge.intent).toBe('session');
  });

  it('open → 200 with manually built credential', async () => {
    const res = await fetch(`${baseUrl}/session`);
    const challenge = Challenge.fromResponse(res);
    const amount = BigInt(challenge.request.amount);

    const sig = await signVoucher(CHANNEL_ID, amount);

    const cred = Credential.from({
      challenge,
      payload: {
        action: 'open',
        channelId: CHANNEL_ID,
        cumulativeAmount: amount.toString(),
        signature: sig,
        txHash: `0x${'aa'.repeat(32)}`,
      },
    });

    const openRes = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: Credential.serialize(cred) },
    });
    expect(openRes.status).toBe(200);
  });

  it('voucher after open → 200', async () => {
    // Open first
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const openAmount = BigInt(ch1.request.amount);
    const openSig = await signVoucher(CHANNEL_ID, openAmount);
    const openCred = Credential.from({
      challenge: ch1,
      payload: { action: 'open', channelId: CHANNEL_ID, cumulativeAmount: openAmount.toString(), signature: openSig, txHash: `0x${'aa'.repeat(32)}` },
    });
    await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(openCred) } });

    // Voucher
    const res2 = await fetch(`${baseUrl}/session`);
    const ch2 = Challenge.fromResponse(res2);
    const voucherAmount = openAmount * 2n;
    const voucherSig = await signVoucher(CHANNEL_ID, voucherAmount);
    const voucherCred = Credential.from({
      challenge: ch2,
      payload: { action: 'voucher', channelId: CHANNEL_ID, cumulativeAmount: voucherAmount.toString(), signature: voucherSig },
    });

    const voucherRes = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: Credential.serialize(voucherCred) },
    });
    expect(voucherRes.status).toBe(200);
  });

  it('3 vouchers on same channel', async () => {
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const tickAmount = BigInt(ch1.request.amount);

    const openSig = await signVoucher(CHANNEL_ID, tickAmount);
    const openCred = Credential.from({
      challenge: ch1,
      payload: { action: 'open', channelId: CHANNEL_ID, cumulativeAmount: tickAmount.toString(), signature: openSig, txHash: `0x${'aa'.repeat(32)}` },
    });
    await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(openCred) } });

    for (let i = 2; i <= 4; i++) {
      const res = await fetch(`${baseUrl}/session`);
      const ch = Challenge.fromResponse(res);
      const cum = tickAmount * BigInt(i);
      const sig = await signVoucher(CHANNEL_ID, cum);
      const cred = Credential.from({
        challenge: ch,
        payload: { action: 'voucher', channelId: CHANNEL_ID, cumulativeAmount: cum.toString(), signature: sig },
      });
      const result = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(cred) } });
      expect(result.status).toBe(200);
    }
  });

  it('close → 200 + channel finalized', async () => {
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const tickAmount = BigInt(ch1.request.amount);

    // Open
    const openSig = await signVoucher(CHANNEL_ID, tickAmount);
    const openCred = Credential.from({
      challenge: ch1,
      payload: { action: 'open', channelId: CHANNEL_ID, cumulativeAmount: tickAmount.toString(), signature: openSig, txHash: `0x${'aa'.repeat(32)}` },
    });
    await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(openCred) } });

    // Close
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    const res2 = await fetch(`${baseUrl}/session`);
    const ch2 = Challenge.fromResponse(res2);
    const closeSig = await signVoucher(CHANNEL_ID, tickAmount);
    const closeCred = Credential.from({
      challenge: ch2,
      payload: { action: 'close', channelId: CHANNEL_ID, cumulativeAmount: tickAmount.toString(), signature: closeSig },
    });
    const closeRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(closeCred) } });
    expect(closeRes.status).toBe(200);
    expect(mocks.walletClient.writeContract).toHaveBeenCalled();
  });

  it('full lifecycle: open → voucher × 3 → close → post-close rejected', async () => {
    const res1 = await fetch(`${baseUrl}/session`);
    const ch1 = Challenge.fromResponse(res1);
    const tickAmount = BigInt(ch1.request.amount);

    // Open
    const openSig = await signVoucher(CHANNEL_ID, tickAmount);
    const openCred = Credential.from({
      challenge: ch1,
      payload: { action: 'open', channelId: CHANNEL_ID, cumulativeAmount: tickAmount.toString(), signature: openSig, txHash: `0x${'aa'.repeat(32)}` },
    });
    const openRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(openCred) } });
    expect(openRes.status).toBe(200);

    // 3 vouchers
    for (let i = 2; i <= 4; i++) {
      const res = await fetch(`${baseUrl}/session`);
      const ch = Challenge.fromResponse(res);
      const cum = tickAmount * BigInt(i);
      const sig = await signVoucher(CHANNEL_ID, cum);
      const cred = Credential.from({
        challenge: ch,
        payload: { action: 'voucher', channelId: CHANNEL_ID, cumulativeAmount: cum.toString(), signature: sig },
      });
      const result = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(cred) } });
      expect(result.status).toBe(200);
    }

    // Close
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    const closeRes1 = await fetch(`${baseUrl}/session`);
    const closeCh = Challenge.fromResponse(closeRes1);
    const finalCum = tickAmount * 4n;
    const closeSig = await signVoucher(CHANNEL_ID, finalCum);
    const closeCred = Credential.from({
      challenge: closeCh,
      payload: { action: 'close', channelId: CHANNEL_ID, cumulativeAmount: finalCum.toString(), signature: closeSig },
    });
    const closeRes = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(closeCred) } });
    expect(closeRes.status).toBe(200);

    // Post-close voucher → rejected (channel finalized)
    const postRes = await fetch(`${baseUrl}/session`);
    const postCh = Challenge.fromResponse(postRes);
    const postSig = await signVoucher(CHANNEL_ID, finalCum + tickAmount);
    const postCred = Credential.from({
      challenge: postCh,
      payload: { action: 'voucher', channelId: CHANNEL_ID, cumulativeAmount: (finalCum + tickAmount).toString(), signature: postSig },
    });
    const postResult = await fetch(`${baseUrl}/session`, { headers: { Authorization: Credential.serialize(postCred) } });
    expect(postResult.status).toBe(402);
  });
});
