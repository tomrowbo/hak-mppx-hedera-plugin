/**
 * Live demo: AI agent paying for APIs using MPP on Hedera.
 *
 * Spins up a real mppx server, registers the plugin with the real
 * Hedera Agent Kit, and calls all 4 tools with real USDC on testnet.
 *
 * Prerequisites:
 *   npm install hak-mppx-hedera-plugin mppx-hedera mppx @hiero-ledger/sdk @hashgraph/hedera-agent-kit viem
 *
 * Usage:
 *   HEDERA_ACCOUNT_ID=0.0.12345 HEDERA_PRIVATE_KEY=0x... node examples/agent-demo.mjs
 *
 * Cost: ~0.02 USDC on testnet
 */

import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { HederaAgentAPI, ToolDiscovery } from '@hashgraph/hedera-agent-kit';
import { mppxHederaPlugin } from 'hak-mppx-hedera-plugin';

// mppx server
import { Mppx } from 'mppx/server';
import { hedera, session } from 'mppx-hedera/server';
import { privateKeyToAccount } from 'viem/accounts';
import {
  hederaTestnet, HEDERA_STREAM_CHANNEL_TESTNET, USDC_TESTNET,
} from 'mppx-hedera';
import http from 'http';

// ─── Config ──────────────────────────────────────────────────────
const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID || '0.0.8569027';
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY || '0x6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const ESCROW_ACCOUNT = '0.0.8600318';
const SERVER_ID = 'demo.hedera-mpp.dev';
const SECRET = 'demo-secret-key-that-is-32-chars-min!!!';

const viemAccount = privateKeyToAccount(PRIVATE_KEY);

// ─── Step 1: Start a real mppx server ────────────────────────────
console.log('🚀 Starting mppx server...\n');

const chargeHandler = hedera.charge({
  serverId: SERVER_ID, recipient: ESCROW_ACCOUNT,
  testnet: true, maxRetries: 15, retryDelay: 2000,
});

const sessionHandler = session({
  account: viemAccount, recipient: viemAccount.address,
  escrowContract: HEDERA_STREAM_CHANNEL_TESTNET, currency: USDC_TESTNET,
  amount: '0.001', suggestedDeposit: '0.01', decimals: 6,
  unitType: 'request', testnet: true,
});

const mppx = Mppx.create({
  methods: [chargeHandler, sessionHandler],
  realm: SERVER_ID, secretKey: SECRET,
});

const chargeRoute = mppx.charge({
  amount: '0.000001', currency: '0.0.5449', decimals: 6, recipient: ESCROW_ACCOUNT,
});
const sessionRoute = mppx.session({
  amount: '0.001', currency: USDC_TESTNET, decimals: 6, unitType: 'request',
  recipient: viemAccount.address, suggestedDeposit: '0.01',
  escrowContract: HEDERA_STREAM_CHANNEL_TESTNET,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  const baseUrl = `http://localhost:${server.address().port}`;
  const request = new Request(`${baseUrl}${url.pathname}`, { method: req.method, headers });

  const result = url.pathname.startsWith('/session')
    ? await sessionRoute(request)
    : await chargeRoute(request);

  if (result.status === 402) {
    for (const [k, v] of result.challenge.headers.entries()) res.setHeader(k, v);
    res.writeHead(402);
    res.end(await result.challenge.text());
  } else if (result.status === 200) {
    const response = result.withReceipt(new Response(JSON.stringify({
      data: url.pathname.startsWith('/session')
        ? { flights: ['BA123 £89', 'LH456 £102', 'AF789 £95'] }
        : { weather: 'London: 14°C, partly cloudy' },
    })));
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: url.pathname.startsWith('/session')
        ? { flights: ['BA123 £89', 'LH456 £102', 'AF789 £95'] }
        : { weather: 'London: 14°C, partly cloudy' },
    }));
  }
});

await new Promise(resolve => server.listen(0, resolve));
const baseUrl = `http://localhost:${server.address().port}`;
console.log(`   Server running at ${baseUrl}`);
console.log(`   Charge endpoint: ${baseUrl}/charge`);
console.log(`   Session endpoint: ${baseUrl}/session\n`);

// ─── Step 2: Create Hedera Agent Kit with our plugin ─────────────
console.log('🤖 Setting up Hedera Agent Kit...\n');

const client = Client.forTestnet();
client.setOperator(
  AccountId.fromString(ACCOUNT_ID),
  PrivateKey.fromStringECDSA(PRIVATE_KEY.replace('0x', '')),
);

const context = { network: 'testnet', privateKey: PRIVATE_KEY };
const discovery = new ToolDiscovery([mppxHederaPlugin]);
const tools = discovery.getAllTools(context);
const agent = new HederaAgentAPI(client, context, tools);

console.log(`   Account: ${ACCOUNT_ID}`);
console.log(`   Tools: ${tools.map(t => t.method).join(', ')}\n`);

// ─── Step 3: Charge — agent pays for weather data ────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💰 CHARGE: Agent pays for weather data (one-shot)\n');

const chargeResult = JSON.parse(await agent.run('mppx_hedera_charge_fetch_tool', {
  url: `${baseUrl}/charge`,
  method: 'GET',
  maxAmount: '100000',
}));

console.log(`   Status: ${chargeResult.raw.status}`);
console.log(`   Payment: ${chargeResult.raw.payment?.amount} USDC (base units)`);
console.log(`   Data: ${JSON.stringify(chargeResult.raw.data)}`);
console.log(`   ✅ ${chargeResult.humanMessage}\n`);

// ─── Step 4: Session — agent opens channel for flight data ───────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📡 SESSION OPEN: Agent deposits USDC for flight queries\n');

const openResult = JSON.parse(await agent.run('mppx_hedera_session_open_tool', {
  url: `${baseUrl}/session`,
  deposit: '0.01',
}));

console.log(`   Deposit: ${openResult.raw.deposit} USDC`);
console.log(`   ✅ ${openResult.humanMessage}\n`);

// ─── Step 5: Session fetch × 3 — fast off-chain queries ─────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚡ SESSION FETCH × 3: Off-chain vouchers (no gas)\n');

for (let i = 1; i <= 3; i++) {
  const fetchResult = JSON.parse(await agent.run('mppx_hedera_session_fetch_tool', {
    url: `${baseUrl}/session`,
    method: 'GET',
  }));
  console.log(`   Query ${i}: ${fetchResult.raw.paid ? 'paid with voucher' : 'free'} → ${fetchResult.raw.data?.substring(0, 60)}...`);
}
console.log(`   ✅ 3 queries, 0 on-chain transactions\n`);

// ─── Step 6: Session close — settle on-chain ─────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔒 SESSION CLOSE: Settle on-chain, refund unused deposit\n');

const closeResult = JSON.parse(await agent.run('mppx_hedera_session_close_tool', {
  url: `${baseUrl}/session`,
}));

console.log(`   Status: ${closeResult.raw.status}`);
console.log(`   ✅ ${closeResult.humanMessage}\n`);

// ─── Summary ─────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 SUMMARY\n');
console.log('   Charge:  1 API call  = 1 on-chain tx (native Hedera + Attribution memo)');
console.log('   Session: 3 API calls = 2 on-chain txs (open + close)');
console.log('   Total:   4 API calls, 3 on-chain txs, all real USDC on Hedera testnet');
console.log('\n   All transactions verifiable on https://hashscan.io/testnet');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

server.close();
client.close();
