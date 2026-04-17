/**
 * Bridge between the Hiero SDK (used by Agent Kit) and viem (used by mppx-hedera sessions).
 *
 * The Agent Kit provides a @hiero-ledger/sdk Client with operator credentials.
 * Our session intent needs a viem Account for EIP-712 signing and EVM contract calls.
 * This bridge extracts the private key and creates the viem account.
 */

import type { Client } from '@hiero-ledger/sdk';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, type Chain } from 'viem';
import { hederaTestnet, hederaMainnet } from 'mppx-hedera';

export function resolveChain(network?: string): Chain {
  return network === 'mainnet' ? hederaMainnet : hederaTestnet;
}

export function resolveNetwork(context: { network?: string }): 'testnet' | 'mainnet' {
  return context.network === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Extract the operator's ECDSA private key from a Hiero SDK Client
 * and create a viem Account for EVM operations.
 *
 * Only works with ECDSA (secp256k1) keys — ED25519 keys are not EVM-compatible.
 */
export function clientToViemAccount(client: Client): Account {
  const key = (client as any).operatorAccountKey ?? (client as any)._operator?.key;
  if (!key) throw new Error('Cannot extract operator key from Hiero SDK Client');

  const rawHex = key.toStringRaw();
  return privateKeyToAccount(`0x${rawHex}`);
}

/**
 * Create viem wallet + public clients from a Hiero SDK Client.
 */
export function clientToViemClients(client: Client, network?: string) {
  const account = clientToViemAccount(client);
  const chain = resolveChain(network);

  return {
    account,
    walletClient: createWalletClient({ account, chain, transport: http() }),
    publicClient: createPublicClient({ chain, transport: http() }),
  };
}

/**
 * Get the operator account ID as a string from a Hiero SDK Client.
 */
export function getOperatorId(client: Client): string {
  const id = (client as any).operatorAccountId ?? (client as any)._operator?.accountId;
  if (!id) throw new Error('Cannot extract operator account ID from Hiero SDK Client');
  return id.toString();
}

/**
 * Get the operator private key as a hex string from a Hiero SDK Client.
 */
export function getOperatorKey(client: Client): string {
  const key = (client as any).operatorAccountKey ?? (client as any)._operator?.key;
  if (!key) throw new Error('Cannot extract operator key from Hiero SDK Client');
  return `0x${key.toStringRaw()}`;
}
