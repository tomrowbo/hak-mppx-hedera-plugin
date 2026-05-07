/**
 * mppx_hedera_session_fetch_tool
 *
 * Makes an API call using an existing payment session.
 * Signs an off-chain EIP-712 voucher (sub-millisecond, no gas) and sends the request.
 */

import { BaseTool, type Context } from '@hashgraph/hedera-agent-kit';
import type { Client } from '@hiero-ledger/sdk';
import { z } from 'zod';
import { Challenge } from 'mppx';
import * as sessionStore from '../session-store.js';

export const TOOL_NAME = 'mppx_hedera_session_fetch_tool';

const description = `Fetch data from a server using an existing MPP payment session.

This is the fast path — each call signs an off-chain EIP-712 voucher (sub-millisecond, no gas cost).
A session must be opened first with mppx_hedera_session_open_tool.

Parameters:
- url: The URL to fetch (must be on the same server where a session is open)
- method: HTTP method (GET or POST), defaults to GET
- body: Optional request body for POST requests`;

const parameters = z.object({
  url: z.string().describe('The URL to fetch using the existing session'),
  method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
  body: z.string().optional().describe('Request body for POST requests'),
});

type SessionFetchInput = z.infer<typeof parameters>;

export class SessionFetchTool extends BaseTool<SessionFetchInput, SessionFetchInput> {
  method = TOOL_NAME;
  name = 'MPP Session Fetch';
  description = description;
  parameters = parameters;

  async normalizeParams(params: SessionFetchInput, _context: Context, _client: Client): Promise<SessionFetchInput> {
    return parameters.parse(params);
  }

  async coreAction(args: SessionFetchInput, _context: Context, _client: Client) {
    if ((_context as any).mode === 'returnBytes') {
      throw new Error(
        `${TOOL_NAME} does not support AgentMode.RETURN_BYTES. ` +
        'MPP session fetch requires direct EIP-712 voucher signing with a private key ' +
        '— RETURN_BYTES mode cannot be used because each request signs an off-chain ' +
        'voucher that must be submitted to the server immediately.',
      );
    }

    const { url, method, body } = args;

    // Find the session for this URL
    const session = sessionStore.get(url);
    if (!session) {
      return {
        raw: { error: 'No session open', url },
        humanMessage: `No payment session is open for ${url}. Use mppx_hedera_session_open_tool first.`,
      };
    }

    // 1. Get a new challenge from the server
    const challengeResponse = await fetch(url, { method: 'GET' });
    if (challengeResponse.status !== 402) {
      // Server didn't require payment — return the response directly
      const data = await challengeResponse.text();
      return {
        raw: { status: challengeResponse.status, data, paid: false },
        humanMessage: `Response from ${url} (status ${challengeResponse.status}) — no payment needed.`,
      };
    }

    let challenge;
    try {
      challenge = Challenge.fromResponse(challengeResponse);
    } catch (e: any) {
      return {
        raw: { error: 'Failed to parse challenge', detail: e.message },
        humanMessage: `Failed to parse 402 challenge: ${e.message}`,
      };
    }

    // 2. Sign voucher using existing session (off-chain, <1ms)
    let credential;
    try {
      credential = await session.handler.createCredential({ challenge });
    } catch (e: any) {
      return {
        raw: { error: 'Voucher signing failed', detail: e.message },
        humanMessage: `Failed to sign voucher: ${e.message}. The session may be exhausted — try mppx_hedera_session_close_tool and reopen with a larger deposit.`,
      };
    }

    // 3. Send authorized request
    const paidResponse = await fetch(url, {
      method,
      ...(body ? { body } : {}),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: credential,
      },
    });

    const data = await paidResponse.text();
    return {
      raw: { status: paidResponse.status, data, paid: true },
      humanMessage: `Fetched ${url} using session voucher (off-chain, no gas).`,
    };
  }

  override async shouldSecondaryAction(_coreActionResult: unknown, _context: Context) {
    return false;
  }

  async secondaryAction(_request: unknown, _client: Client, _context: Context) {
    return null;
  }
}

export const sessionFetchTool = new SessionFetchTool();
export default sessionFetchTool;
