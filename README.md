# hak-mppx-hedera-plugin

Hedera Agent Kit plugin for the [Machine Payments Protocol](https://mpp.dev). Enables AI agents to pay for 402-protected APIs using USDC on Hedera.

[![npm](https://img.shields.io/npm/v/hak-mppx-hedera-plugin)](https://www.npmjs.com/package/hak-mppx-hedera-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install hak-mppx-hedera-plugin mppx-hedera mppx viem @hiero-ledger/sdk @hashgraph/hedera-agent-kit
```

## Quick start

```typescript
import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { HederaAgentAPI, ToolDiscovery } from '@hashgraph/hedera-agent-kit';
import { mppxHederaPlugin } from 'hak-mppx-hedera-plugin';

// 1. Create Hiero SDK Client
const client = Client.forTestnet();
client.setOperator(
  AccountId.fromString('0.0.12345'),
  PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY),
);

// 2. Register plugin — privateKey in context is required for signing
const context = {
  network: 'testnet',
  privateKey: process.env.HEDERA_PRIVATE_KEY, // 0x-prefixed hex ECDSA key
};
const discovery = new ToolDiscovery([mppxHederaPlugin]);
const tools = discovery.getAllTools(context);

// 3. Create agent and call tools
const agent = new HederaAgentAPI(client, context, tools);

// One-shot charge: pay for weather data
const result = await agent.run('mppx_hedera_charge_fetch_tool', {
  url: 'https://api.example.com/weather',
  maxAmount: '100000', // max 0.10 USDC
});

// Session: open channel, make 100 fast calls, close
await agent.run('mppx_hedera_session_open_tool', { url: 'https://api.example.com', deposit: '0.10' });
await agent.run('mppx_hedera_session_fetch_tool', { url: 'https://api.example.com/data' });
await agent.run('mppx_hedera_session_close_tool', { url: 'https://api.example.com' });
```

## Context

The plugin requires `privateKey` in the Agent Kit context because the Hiero SDK Client does not expose the raw private key after `setOperator()`. The plugin needs it for EIP-712 voucher signing (sessions) and native Hedera transaction signing (charges).

```typescript
const context = {
  network: 'testnet',       // or 'mainnet'
  privateKey: '0x...',      // ECDSA secp256k1 private key (same key used in setOperator)
};
```

## Tools

### `mppx_hedera_charge_fetch_tool`

One-shot: call a 402-protected API, auto-pay with USDC, return the data.

```
Agent: "Get the weather from api.example.com/weather"
→ Tool fetches URL → gets 402 → pays 0.01 USDC → retries → returns weather data
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | required | API endpoint URL |
| `method` | `GET` \| `POST` | `GET` | HTTP method |
| `body` | string | — | Request body for POST |
| `maxAmount` | string | `100000` | Max USDC in base units (6 decimals). 100000 = $0.10 |

### `mppx_hedera_session_open_tool`

Open a payment channel — deposits USDC into an on-chain escrow contract.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | required | Server base URL |
| `deposit` | string | `0.10` | USDC to deposit (human-readable) |

### `mppx_hedera_session_fetch_tool`

Make an API call using an open session. Signs an off-chain voucher (sub-millisecond, no gas).

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | required | URL to fetch |
| `method` | `GET` \| `POST` | `GET` | HTTP method |
| `body` | string | — | Request body for POST |

### `mppx_hedera_session_close_tool`

Settle and close a payment channel. Server settles on-chain, unused deposit is refunded.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | required | Server URL whose session to close |

## How it works

**Charge flow** (one-shot):
```
Agent → GET /api → 402 + challenge → pay USDC (native Hedera tx) → retry with credential → 200 + data
```

**Session flow** (streaming):
```
Agent → session-open → deposit USDC into escrow (1 on-chain tx)
Agent → session-fetch × N → off-chain vouchers (<1ms each, no gas)
Agent → session-close → settle on-chain (1 tx), refund unused deposit
```

N requests = 2 on-chain transactions, regardless of N.

## Live demo

```bash
node examples/agent-demo.mjs
```

Spins up a real mppx server, registers the plugin with `HederaAgentAPI`, and calls all 4 tools with real USDC on Hedera testnet. See [`examples/agent-demo.mjs`](examples/agent-demo.mjs).

## Testing

```bash
# Unit + integration tests (56 tests, no network)
npm test

# Agent Kit integration (real HederaAgentAPI + real Hedera testnet)
node test/agent-kit.test.mjs

# Full E2E (real mppx server + real Hedera)
node test/e2e.test.mjs
```

## Architecture

This plugin wraps [mppx-hedera](https://www.npmjs.com/package/mppx-hedera), the native MPP method for Hedera. The SDK provides:
- **Charge:** native Hedera `TransferTransaction` with Attribution memo (challenge-bound, replay-proof)
- **Session:** ERC-20 escrow channels with EIP-712 cumulative vouchers

## License

MIT
