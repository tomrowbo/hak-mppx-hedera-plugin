/**
 * mppx_hedera_charge_fetch_tool
 *
 * Calls a 402-protected API and auto-pays with USDC on Hedera.
 * Full flow: GET → 402 challenge → pay via native Hedera tx → retry → return data.
 */

import { BaseTool, type Context } from '@hashgraph/hedera-agent-kit';
import type { Client } from '@hiero-ledger/sdk';
import { z } from 'zod';
import { Challenge } from 'mppx';
import { charge } from 'mppx-hedera/client';
import { getOperatorId, getPrivateKey, resolveNetwork, type MppxContext } from '../bridge.js';

export const TOOL_NAME = 'mppx_hedera_charge_fetch_tool';

const description = `Call a 402-protected API endpoint and automatically pay with USDC on Hedera.

The tool:
1. Sends an HTTP request to the URL
2. If the server returns 402 (Payment Required), parses the MPP challenge
3. Pays the requested amount in USDC via a native Hedera transaction
4. Retries the request with the payment credential
5. Returns the response data

Parameters:
- url: The URL of the API endpoint
- method: HTTP method (GET or POST), defaults to GET
- body: Optional request body for POST requests
- maxAmount: Maximum USDC to pay in base units (6 decimals). Default 100000 = $0.10`;

const parameters = z.object({
  url: z.string().describe('The URL of the 402-protected API endpoint'),
  method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
  body: z.string().optional().describe('Request body for POST requests'),
  maxAmount: z.string().default('100000').describe('Maximum USDC amount in base units (6 decimals). Default: 100000 = $0.10'),
});

type ChargeFetchInput = z.infer<typeof parameters>;

export class ChargeFetchTool extends BaseTool<ChargeFetchInput, ChargeFetchInput> {
  method = TOOL_NAME;
  name = 'MPP Charge Fetch';
  description = description;
  parameters = parameters;

  async normalizeParams(params: ChargeFetchInput, _context: Context, _client: Client): Promise<ChargeFetchInput> {
    return parameters.parse(params);
  }

  async coreAction(args: ChargeFetchInput, context: Context, client: Client) {
    const mppxContext = context as unknown as MppxContext;
    const { url, method, body, maxAmount } = args;

    // 1. Initial request
    const initialResponse = await fetch(url, {
      method,
      ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
    });

    // Not a 402 — return the response directly
    if (initialResponse.status !== 402) {
      const data = await initialResponse.text();
      return {
        raw: { status: initialResponse.status, data },
        humanMessage: `Response from ${url} (status ${initialResponse.status}) — no payment needed.`,
      };
    }

    // 2. Parse 402 challenge
    let challenge;
    try {
      challenge = Challenge.fromResponse(initialResponse);
    } catch (e: any) {
      return {
        raw: { error: 'Failed to parse 402 challenge', detail: e.message },
        humanMessage: `Server returned 402 but the challenge could not be parsed: ${e.message}`,
      };
    }

    // 3. Check amount is within budget
    const requestedAmount = BigInt(challenge.request.amount);
    if (requestedAmount > BigInt(maxAmount)) {
      return {
        raw: { error: 'Amount exceeds budget', requested: challenge.request.amount, maxAmount },
        humanMessage: `Payment too expensive: server wants ${challenge.request.amount} base units but max is ${maxAmount}.`,
      };
    }

    // 4. Create charge handler and pay
    const network = resolveNetwork(mppxContext);
    const chargeHandler = charge({
      operatorId: getOperatorId(client),
      operatorKey: getPrivateKey(mppxContext),
      network,
    });

    let credential;
    try {
      credential = await chargeHandler.createCredential({ challenge });
    } catch (e: any) {
      return {
        raw: { error: 'Payment failed', detail: e.message },
        humanMessage: `Failed to pay: ${e.message}`,
      };
    }

    // 5. Retry with credential
    const paidResponse = await fetch(url, {
      method,
      ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: credential,
      },
    });

    const data = await paidResponse.text();
    return {
      raw: {
        status: paidResponse.status,
        data,
        payment: {
          amount: challenge.request.amount,
          currency: challenge.request.currency,
          method: 'hedera',
          intent: 'charge',
        },
      },
      humanMessage: `Paid ${challenge.request.amount} USDC (base units) and received data from ${url}.`,
    };
  }

  override async shouldSecondaryAction(_coreActionResult: unknown, _context: Context) {
    return false;
  }

  async secondaryAction(_request: unknown, _client: Client, _context: Context) {
    return null;
  }
}

export const chargeFetchTool = new ChargeFetchTool();
export default chargeFetchTool;
