# hak-mppx-hedera-plugin Test Plan

Three tiers matching the Agent Kit's own test structure.
Every test is automated — no manual testing required.

---

## Tier 1: Unit Tests (mocked, fast, no network)

Framework: Vitest. Mock: `vi.mock()` on fetch + `Client.forNetwork({})` dummy client.

### `test/bridge.test.ts` (6 tests)

- [ ] clientToViemAccount extracts ECDSA key and returns valid viem account
- [ ] clientToViemAccount throws for client without operator key
- [ ] getOperatorId returns account ID string
- [ ] getOperatorId throws for client without operator
- [ ] getOperatorKey returns 0x-prefixed hex string
- [ ] resolveChain returns testnet for 'testnet', mainnet for 'mainnet'

### `test/session-store.test.ts` (8 tests)

- [ ] set + get stores and retrieves session
- [ ] get returns undefined for unknown URL
- [ ] has returns true for stored, false for unknown
- [ ] remove deletes session and returns true
- [ ] remove returns false for unknown URL
- [ ] list returns all sessions
- [ ] clear removes all sessions
- [ ] URLs are normalized (trailing slash, path ignored)

### `test/plugin.test.ts` (5 tests)

- [ ] Plugin has correct name, version, description
- [ ] tools() returns 4 tools
- [ ] Each tool has method, name, description, parameters, execute
- [ ] Tool method names match expected constants
- [ ] Tool names exported via mppxHederaPluginToolNames

### `test/charge-fetch.test.ts` (8 tests)

Mock global fetch to simulate 402 flow.

- [ ] Non-402 response returns data directly (no payment)
- [ ] 402 → parses challenge → pays → retries → returns data
- [ ] Amount exceeds maxAmount → returns error (does not pay)
- [ ] Unparseable 402 challenge → returns error
- [ ] Payment failure → returns error
- [ ] Retry after payment returns non-200 → returns error with status
- [ ] POST request passes body correctly
- [ ] Default maxAmount is 100000

### `test/session-open.test.ts` (7 tests)

- [ ] 402 + session challenge → opens channel → stores session → returns success
- [ ] Non-402 response → returns error
- [ ] Non-session intent (charge) → returns error suggesting charge tool
- [ ] Session already open for URL → returns error
- [ ] Channel open fails → returns error
- [ ] Server rejects open credential → returns error
- [ ] Session stored with correct url, deposit, network, openedAt

### `test/session-fetch.test.ts` (6 tests)

- [ ] Fetches using open session → signs voucher → returns data
- [ ] No session open → returns error
- [ ] Server returns non-402 (no payment needed) → returns data directly
- [ ] Voucher signing fails (exhausted) → returns error suggesting close+reopen
- [ ] POST request with body works
- [ ] Multiple fetches increment voucher state

### `test/session-close.test.ts` (6 tests)

- [ ] Closes session → settles on-chain → removes from store → returns success
- [ ] No session open → returns error
- [ ] Server returns non-402 → removes session, returns info
- [ ] Session exhausted → removes session, returns info
- [ ] Server rejects close → still removes session locally
- [ ] Session store is empty after close

**Tier 1 total: 46 tests**

---

## Tier 2: Integration Tests (real mppx server, mocked Hedera)

Spin up a local mppx server with `hedera.charge()` + `hedera.session()` using DI mocks (no real Hedera). Call tools directly with a mock Client.

### `test/integration.test.ts` (8 tests)

Setup: create a local HTTP server with mppx middleware.

- [ ] charge-fetch: 402 → auto-pay → 200 + data (mocked Mirror Node)
- [ ] charge-fetch: correct payment amount in Mirror Node verification
- [ ] session-open: 402 → open credential → 200 (mocked chain)
- [ ] session-fetch: voucher credential → 200 + data
- [ ] session-fetch × 3: multiple calls on same session
- [ ] session-close: close credential → 200 → session removed
- [ ] session-close: post-close fetch returns "no session" error
- [ ] Full lifecycle: open → fetch × 3 → close → fetch fails

**Tier 2 total: 8 tests**

---

## Tier 3: E2E Tests (real Hedera testnet)

Real Agent Kit Client, real USDC, real transactions. The definitive test.

### `test/e2e.test.mjs` (10 tests)

Setup: create a real Hiero SDK Client with testnet credentials. Start a real mppx server.

**Charge:**
- [ ] charge-fetch against real 402 server → real USDC payment → real data
- [ ] charge-fetch amount validation (maxAmount too low → rejected)
- [ ] charge-fetch non-402 endpoint → passthrough

**Session:**
- [ ] session-open → real approve + deposit on testnet
- [ ] session-fetch × 3 → real off-chain vouchers
- [ ] session-close → real on-chain settlement
- [ ] Post-close fetch → returns "no session" error

**Error paths:**
- [ ] charge-fetch against non-existent URL → network error
- [ ] session-open against non-402 server → error
- [ ] Duplicate session-open → error

**Tier 3 total: 10 tests**

---

## Summary

| Tier | Tests | Speed | Network | What it catches |
|------|-------|-------|---------|-----------------|
| Unit | 46 | ~1s | None | Logic bugs, error handling, state management |
| Integration | 8 | ~5s | Local mppx server | Tool ↔ mppx interaction bugs |
| E2E | 10 | ~60s | Real Hedera testnet | Everything — the definitive proof |
| **Total** | **64** | | | |

## Test Commands

```bash
# Unit + integration (fast)
npm test

# E2E (real Hedera, costs ~0.02 USDC)
node test/e2e.test.mjs
```

## References

- Agent Kit core tests: `hedera-agent-kit-js/packages/core/tests/unit/`
- Agent Kit integration tests: `hedera-agent-kit-js/packages/core/tests/integration/`
- SaucerSwap plugin tests: `hak-saucerswap-plugin/tests/`
- Mock client pattern: `Client.forNetwork({})` with `vi.mock()` on execution paths
