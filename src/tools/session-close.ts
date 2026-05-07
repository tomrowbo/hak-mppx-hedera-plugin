/**
 * mppx_hedera_session_close_tool
 *
 * Closes a payment session and settles on-chain.
 * The server calls escrow.close() — payee receives earned amount, payer gets refund.
 */

import { AgentMode, BaseTool, type Context } from '@hashgraph/hedera-agent-kit';
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

type SessionCloseInput = z.infer<typeof parameters>;

export class SessionCloseTool extends BaseTool<SessionCloseInput, SessionCloseInput> {
  method = TOOL_NAME;
  name = 'MPP Session Close';
  description = description;
  parameters = parameters;

  async normalizeParams(params: SessionCloseInput, _context: Context, _client: Client): Promise<SessionCloseInput> {
    return parameters.parse(params);
  }

  async coreAction(args: SessionCloseInput, context: Context, _client: Client) {
    if (context.mode === AgentMode.RETURN_BYTES) {
      throw new Error(
        `${TOOL_NAME} does not support AgentMode.RETURN_BYTES. ` +
        'MPP session close requires direct EIP-712 signing with a private key ' +
        '— RETURN_BYTES mode cannot be used because closing a channel requires signing ' +
        'a close voucher and submitting it to the server for on-chain settlement.',
      );
    }

    const mppxContext = context as unknown as MppxContext;
    if (!mppxContext.privateKey) {
      return {
        raw: { error: 'Missing privateKey' },
        humanMessage: 'context.privateKey is required for MPP session close. Pass your ECDSA private key as a 0x-prefixed hex string.',
      };
    }
    const { url } = args;

    const session = sessionStore.get(url);
    if (!session) {
      return {
        raw: { error: 'No session open', url },
        humanMessage: `No payment session is open for ${url}. Nothing to close.`,
      };
    }

    // 1. Extract channelId and cumulativeAmount from the last credential
    //    We use the stored lastCredential to avoid calling createCredential(),
    //    which would increment cumulativeAmount and overpay by one request.
    if (!session.lastCredential) {
      sessionStore.remove(url);
      return {
        raw: { error: 'No credential to close with', url },
        humanMessage: `No voucher has been issued on this session. Session removed locally.`,
      };
    }

    let channelId: string;
    let cumulativeAmount: bigint;
    try {
      const parsed = Credential.deserialize<{
        channelId: string;
        cumulativeAmount: string;
      }>(session.lastCredential);
      channelId = parsed.payload.channelId;
      cumulativeAmount = BigInt(parsed.payload.cumulativeAmount);
      if (!channelId) throw new Error('channelId missing from credential payload');
      if (parsed.payload.cumulativeAmount == null) throw new Error('cumulativeAmount missing from credential payload');
    } catch (e: any) {
      sessionStore.remove(url);
      return {
        raw: { error: 'Failed to parse credential', detail: e.message },
        humanMessage: `Failed to parse session credential for close: ${e.message}. Session removed locally — the channel may need manual settlement.`,
      };
    }

    // 2. Get the escrow contract from session state (stored at open time)
    const escrow = session.escrowContract;
    if (!escrow) {
      sessionStore.remove(url);
      return {
        raw: { error: 'Escrow contract not found', url },
        humanMessage: `Cannot close: escrow contract address not found in session state. Session removed locally — the channel may need manual settlement.`,
      };
    }

    // 3. Sign close voucher, get challenge, and send — wrapped in try-finally
    //    to ensure session is always cleaned up.
    try {
      const network = resolveNetwork(mppxContext);
      const account = contextToViemAccount(mppxContext);
      const chain = resolveChain(network);

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

      // 4. Get a challenge for the close action
      const challengeResponse = await fetch(url);
      if (challengeResponse.status !== 402) {
        return {
          raw: { error: 'Close challenge failed', status: challengeResponse.status },
          humanMessage: `Failed to get challenge for close (status ${challengeResponse.status}). Session removed locally.`,
        };
      }
      const closeChallenge = Challenge.fromResponse(challengeResponse);

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
    } catch (e: any) {
      return {
        raw: { error: 'Close failed', detail: e.message },
        humanMessage: `Failed to close session: ${e.message}. Session removed locally — the channel may need manual settlement.`,
      };
    } finally {
      sessionStore.remove(url);
    }
  }

  override async shouldSecondaryAction(_coreActionResult: unknown, _context: Context) {
    return false;
  }

  async secondaryAction(_request: unknown, _client: Client, _context: Context) {
    return null;
  }
}

export const sessionCloseTool = new SessionCloseTool();
export default sessionCloseTool;
