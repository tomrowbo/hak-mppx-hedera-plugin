/**
 * mppx_hedera_session_open_tool
 *
 * Opens a payment channel with a 402-protected server.
 * Deposits USDC into an escrow contract, enabling fast off-chain voucher payments.
 */

import { AgentMode, BaseTool, type Context } from '@hashgraph/hedera-agent-kit';
import type { Client } from '@hiero-ledger/sdk';
import { z } from 'zod';
import { Challenge } from 'mppx';
import { hederaSession } from 'mppx-hedera/client';
import { HEDERA_STREAM_CHANNEL_TESTNET, HEDERA_STREAM_CHANNEL_MAINNET } from 'mppx-hedera';
import { contextToViemAccount, resolveNetwork, type MppxContext } from '../bridge.js';
import * as sessionStore from '../session-store.js';

export const TOOL_NAME = 'mppx_hedera_session_open_tool';

const description = `Open a payment channel (session) with a 402-protected API server.

Deposits USDC into an on-chain escrow contract. After opening, use mppx_hedera_session_fetch_tool
to make fast, off-chain payments (sub-millisecond per call, no gas). When done, use
mppx_hedera_session_close_tool to settle and recover unused funds.

Parameters:
- url: The base URL of the API server that supports MPP session payments
- deposit: USDC amount to deposit (human-readable, e.g. "0.10" for 10 cents)`;

const parameters = z.object({
  url: z.string().describe('Base URL of the 402-protected API server'),
  deposit: z.string().default('0.10').describe('USDC to deposit into the channel (e.g. "0.10" for 10 cents)'),
});

type SessionOpenInput = z.infer<typeof parameters>;

export class SessionOpenTool extends BaseTool<SessionOpenInput, SessionOpenInput> {
  method = TOOL_NAME;
  name = 'MPP Session Open';
  description = description;
  parameters = parameters;

  async normalizeParams(params: SessionOpenInput, _context: Context, _client: Client): Promise<SessionOpenInput> {
    return parameters.parse(params);
  }

  async coreAction(args: SessionOpenInput, context: Context, _client: Client) {
    if (context.mode === AgentMode.RETURN_BYTES) {
      throw new Error(
        `${TOOL_NAME} does not support AgentMode.RETURN_BYTES. ` +
        'MPP session open requires direct transaction signing with a private key ' +
        '— RETURN_BYTES mode cannot be used because opening a channel requires an ' +
        'on-chain ERC-20 approve + escrow deposit that must be signed immediately.',
      );
    }

    const mppxContext = context as unknown as MppxContext;
    if (!mppxContext.privateKey) {
      return {
        raw: { error: 'Missing privateKey' },
        humanMessage: 'context.privateKey is required for MPP session operations. Pass your ECDSA private key as a 0x-prefixed hex string.',
      };
    }
    const { url, deposit } = args;

    // Check if session already exists
    if (sessionStore.has(url)) {
      return {
        raw: { error: 'Session already open', url },
        humanMessage: `A session is already open for ${url}. Use mppx_hedera_session_fetch_tool to make calls, or mppx_hedera_session_close_tool to close it first.`,
      };
    }

    // 1. Get session challenge from server
    const response = await fetch(url);
    if (response.status !== 402) {
      return {
        raw: { error: 'Server did not return 402', status: response.status },
        humanMessage: `Expected 402 from ${url} but got ${response.status}. This server may not support MPP session payments.`,
      };
    }

    let challenge;
    try {
      challenge = Challenge.fromResponse(response);
    } catch (e: any) {
      return {
        raw: { error: 'Failed to parse challenge', detail: e.message },
        humanMessage: `Server returned 402 but the challenge could not be parsed: ${e.message}`,
      };
    }

    if (challenge.intent !== 'session') {
      return {
        raw: { error: 'Not a session intent', intent: challenge.intent },
        humanMessage: `Server supports ${challenge.intent} intent, not session. Use mppx_hedera_charge_fetch_tool instead.`,
      };
    }

    // 2. Create session handler with viem account (bridge from Agent Kit)
    const network = resolveNetwork(mppxContext);
    const account = contextToViemAccount(mppxContext);

    // Pin escrow to the known deployed contract to prevent a malicious server
    // from redirecting deposits to an attacker-controlled contract.
    const knownEscrow = network === 'mainnet'
      ? HEDERA_STREAM_CHANNEL_MAINNET
      : HEDERA_STREAM_CHANNEL_TESTNET;

    const handler = hederaSession({ account, deposit, escrowContract: knownEscrow });

    // 3. Open channel (approve + deposit on-chain)
    let credential;
    try {
      credential = await handler.createCredential({ challenge });
    } catch (e: any) {
      return {
        raw: { error: 'Failed to open channel', detail: e.message },
        humanMessage: `Failed to open payment channel: ${e.message}`,
      };
    }

    // 4. Send open credential to server
    const openResponse = await fetch(url, {
      headers: { Authorization: credential },
    });

    if (openResponse.status !== 200) {
      return {
        raw: { error: 'Server rejected open', status: openResponse.status },
        humanMessage: `Server rejected the channel open (status ${openResponse.status}).`,
      };
    }

    // 5. Store session for future fetch/close calls
    sessionStore.set(url, {
      handler,
      url,
      deposit,
      network,
      openedAt: new Date().toISOString(),
      lastCredential: credential,
      escrowContract: knownEscrow,
    });

    return {
      raw: { url, deposit, network, status: 'open' },
      humanMessage: `Payment channel opened with ${url}. Deposited ${deposit} USDC. Use mppx_hedera_session_fetch_tool to make calls.`,
    };
  }

  override async shouldSecondaryAction(_coreActionResult: unknown, _context: Context) {
    return false;
  }

  async secondaryAction(_request: unknown, _client: Client, _context: Context) {
    return null;
  }
}

export const sessionOpenTool = new SessionOpenTool();
export default sessionOpenTool;
