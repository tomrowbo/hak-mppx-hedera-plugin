/**
 * mppx_hedera_session_close_tool
 *
 * Closes a payment session and settles on-chain.
 * The server calls escrow.close() — payee receives earned amount, payer gets refund.
 */

import type { Client } from '@hiero-ledger/sdk';
import { z } from 'zod';
import { Challenge, Credential } from 'mppx';
import { createWalletClient, http } from 'viem';
import {
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
  VOUCHER_TYPES,
} from 'mppx-hedera';
import { contextToViemAccount, resolveChain, resolveNetwork, type MppxContext } from '../bridge.js';
import * as sessionStore from '../session-store.js';

export const TOOL_NAME = 'mppx_hedera_session_close_tool';

const description = `Close a payment session and settle on-chain.

The server settles the escrow contract — the payee receives the earned amount and the
payer gets a refund for any unused deposit. After closing, the session is removed.

Parameters:
- url: The URL of the server whose session to close`;

const parameters = z.object({
  url: z.string().describe('The URL of the server whose session to close'),
});

type Context = MppxContext;

async function execute(client: Client, context: Context, params: z.infer<typeof parameters>) {
  const { url } = params;

  const session = sessionStore.get(url);
  if (!session) {
    return {
      raw: { error: 'No session open', url },
      humanMessage: `No payment session is open for ${url}. Nothing to close.`,
    };
  }

  // 1. Get a close challenge from the server
  const challengeResponse = await fetch(url);
  if (challengeResponse.status !== 402) {
    // Remove the session anyway since it may be stale
    sessionStore.remove(url);
    return {
      raw: { error: 'Server did not return 402', status: challengeResponse.status },
      humanMessage: `Server returned ${challengeResponse.status} instead of 402. Session removed.`,
    };
  }

  let challenge;
  try {
    challenge = Challenge.fromResponse(challengeResponse);
  } catch (e: any) {
    return {
      raw: { error: 'Failed to parse challenge', detail: e.message },
      humanMessage: `Failed to parse close challenge: ${e.message}`,
    };
  }

  // 2. Build close credential
  // We need to get the channelId and current cumulative from the session handler.
  // The handler stores channels internally, but we can get the last credential's info
  // by making one more voucher call to get the current state, then sending a close.

  // Get the current cumulative by signing a close voucher with the handler
  // The simplest approach: send a close action credential
  // First, we need the channelId — extract from a voucher credential
  let lastCredential;
  try {
    lastCredential = await session.handler.createCredential({ challenge });
  } catch (e: any) {
    // Session may be exhausted — still try to close
    sessionStore.remove(url);
    return {
      raw: { error: 'Session exhausted', detail: e.message },
      humanMessage: `Session appears exhausted. Removed locally. The server may settle automatically.`,
    };
  }

  // Parse the credential to get channelId and cumulative amount
  const b64 = lastCredential.replace('Payment ', '');
  const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString());
  const channelId = parsed.payload.channelId;
  const cumulativeAmount = BigInt(parsed.payload.cumulativeAmount);

  // 3. Sign a close voucher (EIP-712)
  const network = resolveNetwork(context);
  const account = contextToViemAccount(context);
  const chain = resolveChain(network);
  const escrow = challenge.request.methodDetails?.escrowContract ?? challenge.request.escrowContract;

  const walletClient = createWalletClient({ account, chain, transport: http() });

  const closeSig = await walletClient.signTypedData({
    account,
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId: chain.id,
      verifyingContract: escrow as `0x${string}`,
    },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: { channelId, cumulativeAmount },
  });

  // 4. Get a fresh challenge for the close action
  const closeChallengeResponse = await fetch(url);
  const closeChallenge = Challenge.fromResponse(closeChallengeResponse);

  // 5. Build and send close credential
  const closeCred = Credential.from({
    challenge: closeChallenge,
    payload: {
      action: 'close',
      channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      signature: closeSig,
    },
  });

  const closeResponse = await fetch(url, {
    headers: { Authorization: Credential.serialize(closeCred) },
  });

  // 6. Clean up
  sessionStore.remove(url);

  if (closeResponse.status === 200) {
    return {
      raw: { url, status: 'closed', settled: cumulativeAmount.toString() },
      humanMessage: `Session closed for ${url}. Settled ${cumulativeAmount} base units on-chain. Unused deposit refunded.`,
    };
  }

  return {
    raw: { url, status: 'close_attempted', serverStatus: closeResponse.status },
    humanMessage: `Close sent to ${url} (server returned ${closeResponse.status}). Session removed locally.`,
  };
}

export default (context: Context = {}) => ({
  method: TOOL_NAME,
  name: 'MPP Session Close',
  description,
  parameters,
  execute,
});
