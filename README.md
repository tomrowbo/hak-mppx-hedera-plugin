# hak-mppx-hedera-plugin

Hedera Agent Kit plugin for the [Machine Payments Protocol](https://mpp.dev). Enables AI agents to pay for 402-protected APIs using USDC on Hedera.

[![npm](https://img.shields.io/npm/v/hak-mppx-hedera-plugin)](https://www.npmjs.com/package/hak-mppx-hedera-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install hak-mppx-hedera-plugin mppx-hedera mppx viem @hiero-ledger/sdk
```

## Usage

```typescript
import { HederaAgentKit } from '@hashgraph/hedera-agent-kit';
import { mppxHederaPlugin, mppxHederaPluginToolNames } from 'hak-mppx-hedera-plugin';

const kit = new HederaAgentKit({
  client,
  configuration: {
    plugins: [mppxHederaPlugin],
    context: { network: 'testnet' },
  },
});
```

## Tools

### `mppx_hedera_charge_fetch_tool`

One-shot: call a 402-protected API, auto-pay with USDC, return the data.

```
Agent: "Get the weather from api.example.com/weather"
→ Tool fetches URL → gets 402 → pays 0.01 USDC → retries → returns weather data
```

**Parameters:**
- `url` — API endpoint URL
- `method` — GET or POST (default: GET)
- `body` — Optional request body
- `maxAmount` — Max USDC to pay in base units (default: 100000 = $0.10)

### `mppx_hedera_session_open_tool`

Open a payment channel — deposits USDC into an on-chain escrow contract.

**Parameters:**
- `url` — Server base URL
- `deposit` — USDC to deposit (default: "0.10")

### `mppx_hedera_session_fetch_tool`

Make an API call using an open session. Signs an off-chain voucher (sub-millisecond, no gas).

**Parameters:**
- `url` — URL to fetch
- `method` — GET or POST
- `body` — Optional request body

### `mppx_hedera_session_close_tool`

Settle and close a payment channel. Server settles on-chain, unused deposit is refunded.

**Parameters:**
- `url` — Server URL whose session to close

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

## Architecture

This plugin wraps [mppx-hedera](https://www.npmjs.com/package/mppx-hedera), the native MPP method for Hedera. The bridge between the Agent Kit's `@hiero-ledger/sdk` Client and mppx-hedera's viem-based session is handled automatically.

## License

MIT
