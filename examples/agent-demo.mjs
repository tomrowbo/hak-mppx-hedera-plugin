/**
 * Example: AI agent using the mppx-hedera plugin to pay for APIs.
 *
 * This demonstrates how an Agent Kit agent would use the 4 MPP tools:
 *   1. Charge fetch — one-shot: call API, auto-pay, get data
 *   2. Session open — deposit USDC into payment channel
 *   3. Session fetch — fast off-chain calls (no gas)
 *   4. Session close — settle and recover unused deposit
 *
 * Prerequisites:
 *   npm install hak-mppx-hedera-plugin mppx-hedera @hiero-ledger/sdk
 *
 * Usage:
 *   HEDERA_ACCOUNT_ID=0.0.12345 HEDERA_PRIVATE_KEY=0x... node examples/agent-demo.mjs
 */

import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { mppxHederaPlugin } from 'hak-mppx-hedera-plugin';

// ── Setup ────────────────────────────────────────────────────────
const accountId = process.env.HEDERA_ACCOUNT_ID;
const privateKey = process.env.HEDERA_PRIVATE_KEY;

if (!accountId || !privateKey) {
  console.error('Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY environment variables');
  process.exit(1);
}

// Create Hiero SDK Client (same as Agent Kit would provide)
const client = Client.forTestnet();
client.setOperator(
  AccountId.fromString(accountId),
  PrivateKey.fromStringECDSA(privateKey.replace('0x', '')),
);

// Register plugin and get tools
const context = { network: 'testnet' };
const tools = mppxHederaPlugin.tools(context);

console.log('mppx-hedera Agent Kit Plugin — Demo\n');
console.log(`Registered ${tools.length} tools:`);
for (const tool of tools) {
  console.log(`  - ${tool.method}: ${tool.name}`);
}

// ── Helper to call a tool by name ────────────────────────────────
async function callTool(methodName, params) {
  const tool = tools.find(t => t.method === methodName);
  if (!tool) throw new Error(`Tool not found: ${methodName}`);

  console.log(`\n▶ Calling ${tool.name}...`);
  const result = await tool.execute(client, context, params);
  console.log(`  Result: ${result.humanMessage}`);
  return result;
}

// ── Demo: Charge fetch ───────────────────────────────────────────
console.log('\n═══ Demo 1: Charge (one-shot payment) ═══');
console.log('An agent needs weather data from a paid API.\n');

// In a real scenario, this URL would be a 402-protected endpoint.
// For demo purposes, we show the tool setup:
console.log('Tool: mppx_hedera_charge_fetch_tool');
console.log('Input: { url: "https://api.weather.example/london", maxAmount: "10000" }');
console.log('Flow: GET → 402 → pay 0.01 USDC → retry → weather data');

// ── Demo: Session lifecycle ──────────────────────────────────────
console.log('\n═══ Demo 2: Session (streaming payments) ═══');
console.log('An agent needs to make 100 API calls to compare prices.\n');

console.log('Step 1: mppx_hedera_session_open_tool');
console.log('  Input: { url: "https://api.flights.example", deposit: "0.10" }');
console.log('  Flow: approve USDC → deposit into escrow → channel open');

console.log('\nStep 2: mppx_hedera_session_fetch_tool × 100');
console.log('  Input: { url: "https://api.flights.example/LON-BER" }');
console.log('  Flow: sign off-chain voucher (<1ms) → get data');
console.log('  Total on-chain cost: 0 (vouchers are off-chain)');

console.log('\nStep 3: mppx_hedera_session_close_tool');
console.log('  Input: { url: "https://api.flights.example" }');
console.log('  Flow: settle on-chain → payee gets earned amount → payer gets refund');

console.log('\n═══ Summary ═══');
console.log('100 API calls = 2 on-chain transactions (open + close)');
console.log('Each call costs ~$0.001 USDC. Total: ~$0.10');
console.log('Without sessions: 100 on-chain transactions\n');

// ── Verify tools are callable ────────────────────────────────────
console.log('Plugin ready. Tools available for Agent Kit integration.');
console.log(`\nTo use with Agent Kit:`);
console.log(`
  import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
  import { mppxHederaPlugin } from 'hak-mppx-hedera-plugin';

  const toolkit = new HederaLangchainToolkit({
    client,
    configuration: {
      plugins: [mppxHederaPlugin],
      context: { network: 'testnet' },
    },
  });
`);

client.close();
