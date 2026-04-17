/**
 * Real Agent Kit integration test.
 *
 * Registers our plugin with HederaAgentAPI + ToolDiscovery,
 * then calls tools through the official Agent Kit API against
 * a real mppx server on Hedera testnet.
 *
 * This is the definitive proof the plugin works with the Agent Kit.
 *
 * Usage: node test/agent-kit.test.mjs
 */

import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { HederaAgentAPI, ToolDiscovery } from '@hashgraph/hedera-agent-kit';
import { mppxHederaPlugin, mppxHederaPluginToolNames } from '../dist/index.js';

// mppx server setup
import { Mppx } from 'mppx/server';
import { Challenge, Credential } from 'mppx';
import { hedera, session } from 'mppx-hedera/server';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http as viemHttp } from 'viem';
import {
  hederaTestnet, HEDERA_STREAM_CHANNEL_TESTNET, USDC_TESTNET,
  VOUCHER_DOMAIN_NAME, VOUCHER_DOMAIN_VERSION, VOUCHER_TYPES,
} from 'mppx-hedera';
import http from 'http';

// ─── Config ──────────────────────────────────────────────────────
const OPERATOR_ID = '0.0.8569027';
const OPERATOR_KEY = '6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const OPERATOR_ACCOUNT = privateKeyToAccount(`0x${OPERATOR_KEY}`);
const ESCROW = HEDERA_STREAM_CHANNEL_TESTNET;
const TOKEN = USDC_TESTNET;
const ESCROW_ACCOUNT = '0.0.8600318';
const SERVER_ID = 'agent-kit-test.hedera-mpp.dev';
const SECRET_KEY = 'agent-kit-test-secret-key-32-chars-min!!';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

// ─── Start real mppx server ──────────────────────────────────────
async function startServer() {
  const chargeHandler = hedera.charge({
    serverId: SERVER_ID,
    recipient: ESCROW_ACCOUNT,
    testnet: true,
    maxRetries: 15,
    retryDelay: 2000,
  });

  const sessionHandler = session({
    account: OPERATOR_ACCOUNT,
    recipient: OPERATOR_ACCOUNT.address,
    escrowContract: ESCROW,
    currency: TOKEN,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: true,
  });

  const mppx = Mppx.create({
    methods: [chargeHandler, sessionHandler],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  const chargeRoute = mppx.charge({
    amount: '0.000001', currency: '0.0.5449', decimals: 6, recipient: ESCROW_ACCOUNT,
  });

  const sessionRoute = mppx.session({
    amount: '0.001', currency: TOKEN, decimals: 6, unitType: 'request',
    recipient: OPERATOR_ACCOUNT.address, suggestedDeposit: '0.01', escrowContract: ESCROW,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
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
      const response = result.withReceipt(new Response('{"data":"from-agent-kit"}'));
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.writeHead(200);
      res.end('{"data":"from-agent-kit"}');
    }
  });

  await new Promise(resolve => server.listen(0, resolve));
  return { server, baseUrl: `http://localhost:${server.address().port}` };
}

// ─── Tests ───────────────────────────────────────────────────────
async function main() {
  console.log('hak-mppx-hedera-plugin — Agent Kit Integration Test');
  console.log('Real HederaAgentAPI + ToolDiscovery + real Hedera testnet\n');

  // ── Step 1: Create real Hiero SDK Client ────────────────────────
  console.log('═══ Setup ═══');
  const client = Client.forTestnet();
  client.setOperator(
    AccountId.fromString(OPERATOR_ID),
    PrivateKey.fromStringECDSA(OPERATOR_KEY),
  );
  console.log(`  Client: ${OPERATOR_ID} on testnet`);

  // ── Step 2: Register plugin with ToolDiscovery ──────────────────
  const context = { network: 'testnet', privateKey: `0x${OPERATOR_KEY}` };
  const discovery = new ToolDiscovery([mppxHederaPlugin]);
  const tools = discovery.getAllTools(context);

  assert(tools.length === 4, `ToolDiscovery found ${tools.length} tools (expected 4)`);

  const toolNames = tools.map(t => t.method);
  assert(toolNames.includes('mppx_hedera_charge_fetch_tool'), 'charge_fetch registered');
  assert(toolNames.includes('mppx_hedera_session_open_tool'), 'session_open registered');
  assert(toolNames.includes('mppx_hedera_session_fetch_tool'), 'session_fetch registered');
  assert(toolNames.includes('mppx_hedera_session_close_tool'), 'session_close registered');

  // ── Step 3: Create HederaAgentAPI ───────────────────────────────
  const agent = new HederaAgentAPI(client, context, tools);
  assert(!!agent, 'HederaAgentAPI created');

  // ── Step 4: Start real mppx server ──────────────────────────────
  const { server, baseUrl } = await startServer();
  console.log(`  Server: ${baseUrl}`);

  try {
    // ── Test 1: Charge via agent.run() ────────────────────────────
    console.log('\n═══ Test 1: Charge via HederaAgentAPI.run() ═══');

    const chargeResult = await agent.run('mppx_hedera_charge_fetch_tool', {
      url: `${baseUrl}/charge`,
      method: 'GET',
      maxAmount: '100000',
    });

    const chargeParsed = JSON.parse(chargeResult);
    assert(chargeParsed.raw.status === 200, `Charge: got 200 (got ${chargeParsed.raw.status})`);
    assert(chargeParsed.raw.data.includes('from-agent-kit'), 'Charge: got real data');
    assert(chargeParsed.raw.payment.method === 'hedera', 'Charge: payment method is hedera');
    console.log(`  Payment: ${chargeParsed.raw.payment.amount} base units`);

    // ── Test 2: Direct tool.execute() ─────────────────────────────
    console.log('\n═══ Test 2: Direct tool.execute() ═══');

    const chargeTool = tools.find(t => t.method === 'mppx_hedera_charge_fetch_tool');
    const directResult = await chargeTool.execute(client, context, {
      url: `${baseUrl}/charge`,
      method: 'GET',
      maxAmount: '100000',
    });

    assert(directResult.raw.status === 200, 'Direct: got 200');
    assert(typeof directResult.humanMessage === 'string', 'Direct: has humanMessage');
    console.log(`  humanMessage: ${directResult.humanMessage}`);

    // ── Test 3: Session lifecycle via agent.run() ─────────────────
    console.log('\n═══ Test 3: Session open via agent.run() ═══');

    const openResult = await agent.run('mppx_hedera_session_open_tool', {
      url: `${baseUrl}/session`,
      deposit: '0.01',
    });
    const openParsed = JSON.parse(openResult);
    assert(openParsed.raw.status === 'open', `Session open: status=${openParsed.raw.status}`);

    // ── Test 5: Session fetch via agent.run() ─────────────────────
    console.log('\n═══ Test 5: Session fetch via agent.run() ═══');

    const fetchResult = await agent.run('mppx_hedera_session_fetch_tool', {
      url: `${baseUrl}/session`,
      method: 'GET',
    });
    const fetchParsed = JSON.parse(fetchResult);
    assert(fetchParsed.raw.paid === true, 'Session fetch: paid with voucher');
    assert(fetchParsed.raw.status === 200, 'Session fetch: got 200');

    // ── Test 6: Session close via agent.run() ─────────────────────
    console.log('\n═══ Test 6: Session close via agent.run() ═══');

    const closeResult = await agent.run('mppx_hedera_session_close_tool', {
      url: `${baseUrl}/session`,
    });
    const closeParsed = JSON.parse(closeResult);
    assert(
      closeParsed.raw.status === 'closed' || closeParsed.raw.status === 'close_attempted',
      `Session close: status=${closeParsed.raw.status}`,
    );

    // ── Test 7: Post-close fetch fails ────────────────────────────
    console.log('\n═══ Test 7: Post-close fetch ═══');

    const postCloseResult = await agent.run('mppx_hedera_session_fetch_tool', {
      url: `${baseUrl}/session`,
    });
    const postCloseParsed = JSON.parse(postCloseResult);
    assert(postCloseParsed.raw.error === 'No session open', 'Post-close: no session error');

  } finally {
    server.close();
    client.close();
  }

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ AGENT KIT INTEGRATION PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
