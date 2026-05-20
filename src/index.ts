/**
 * hak-mppx-hedera-plugin
 *
 * Hedera Agent Kit plugin for Machine Payments Protocol (MPP).
 * Enables AI agents to pay for 402-protected APIs using USDC on Hedera.
 *
 * Tools:
 * - mppx_hedera_charge_fetch_tool  — one-shot: call API, auto-pay, get data
 * - mppx_hedera_session_open_tool  — open a payment channel (deposit USDC)
 * - mppx_hedera_session_fetch_tool — call API using open channel (off-chain, fast)
 * - mppx_hedera_session_close_tool — settle and close channel (refund unused deposit)
 */

import type { Plugin, Tool, Context } from '@hashgraph/hedera-agent-kit';
import { chargeFetchTool, TOOL_NAME as CHARGE_FETCH } from './tools/charge-fetch.js';
import { sessionOpenTool, TOOL_NAME as SESSION_OPEN } from './tools/session-open.js';
import { sessionFetchTool, TOOL_NAME as SESSION_FETCH } from './tools/session-fetch.js';
import { sessionCloseTool, TOOL_NAME as SESSION_CLOSE } from './tools/session-close.js';

export const mppxHederaPluginToolNames = {
  CHARGE_FETCH,
  SESSION_OPEN,
  SESSION_FETCH,
  SESSION_CLOSE,
} as const;

export const mppxHederaPlugin: Plugin = {
  name: 'hak-mppx-hedera-plugin',
  version: '1.2.1',
  description: 'Machine Payments Protocol (MPP) for Hedera — charge and session payments with USDC. Enables AI agents to pay for 402-protected APIs.',
  // Cast needed: zod/v3 re-export has a different class identity than
  // agent-kit's bundled zod v3 due to private fields. Structurally identical.
  tools: (_context: Context): Tool[] => [
    chargeFetchTool as unknown as Tool,
    sessionOpenTool as unknown as Tool,
    sessionFetchTool as unknown as Tool,
    sessionCloseTool as unknown as Tool,
  ],
};

// Default export for convenience
export default mppxHederaPlugin;

// Re-export tool classes for advanced usage
export { ChargeFetchTool } from './tools/charge-fetch.js';
export { SessionOpenTool } from './tools/session-open.js';
export { SessionFetchTool } from './tools/session-fetch.js';
export { SessionCloseTool } from './tools/session-close.js';

// Re-export session store for advanced usage
export * as sessionStore from './session-store.js';

// Re-export bridge utilities
export type { MppxContext } from './bridge.js';
export { contextToViemAccount, contextToViemClients, getOperatorId, getPrivateKey } from './bridge.js';
