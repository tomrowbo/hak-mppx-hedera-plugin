/**
 * Bridge between the Hiero SDK (used by Agent Kit) and viem (used by mppx-hedera sessions).
 *
 * The Hiero SDK Client does NOT expose the raw private key after setOperator().
 * It only stores a transactionSigner function. So the plugin context must carry
 * the private key separately for viem operations (EIP-712 signing, EVM calls).
 *
 * The plugin reads `context.privateKey` (hex string) for the viem bridge.
 */

import type { Client } from '@hiero-ledger/sdk';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, type Chain } from 'viem';
import { hederaTestnet, hederaMainnet } from 'mppx-hedera';

export interface MppxContext {
  network?: string;
  privateKey?: string; // 0x-prefixed hex ECDSA key for viem bridge
  accountId?: string;  // fallback operator account ID (e.g. '0.0.12345')
  [key: string]: unknown;
}

export function resolveChain(network?: string): Chain {
  return network === 'mainnet' ? hederaMainnet : hederaTestnet;
}

export function resolveNetwork(context: MppxContext): 'testnet' | 'mainnet' {
  return context.network === 'mainnet' ? 'mainnet' : 'testnet';
}

// DER prefix for Ed25519 private keys (RFC 8410)
const ED25519_DER_PREFIX = '302e020100300506032b657004220420';

/**
 * Create a viem Account from the context's private key.
 * Rejects Ed25519 keys early with a clear error instead of silent failure.
 */
export function contextToViemAccount(context: MppxContext): Account {
  if (!context.privateKey) {
    throw new Error('context.privateKey is required for MPP session operations. Pass your ECDSA private key as a 0x-prefixed hex string.');
  }
  const raw = context.privateKey.startsWith('0x') ? context.privateKey.slice(2) : context.privateKey;
  if (raw.toLowerCase().startsWith(ED25519_DER_PREFIX)) {
    throw new Error(
      'Ed25519 keys are not supported. MPP requires an ECDSA (secp256k1) key for EIP-712 signing and EVM-address derivation. ' +
      'Check your account key type on hashscan.io — ECDSA accounts have an EVM address (0x…), Ed25519 accounts do not.',
    );
  }
  const key = `0x${raw}` as `0x${string}`;
  return privateKeyToAccount(key);
}

/**
 * Create viem wallet + public clients from context.
 */
export function contextToViemClients(context: MppxContext): {
  account: Account;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
} {
  const account = contextToViemAccount(context);
  const chain = resolveChain(context.network);

  return {
    account,
    walletClient: createWalletClient({ account, chain, transport: http() }),
    publicClient: createPublicClient({ chain, transport: http() }),
  };
}

/**
 * Get the operator account ID from the Hiero SDK Client, falling back to context.accountId.
 */
export function getOperatorId(client: Client, context?: MppxContext): string {
  const id = (client as any).operatorAccountId ?? (client as any)._operator?.accountId;
  if (id) return id.toString();
  if (context?.accountId) return context.accountId;
  throw new Error('Cannot determine operator account ID. Provide it via client.setOperator() or context.accountId.');
}

/**
 * Get the private key from context as a 0x-prefixed hex string.
 */
export function getPrivateKey(context: MppxContext): string {
  if (!context.privateKey) {
    throw new Error('context.privateKey is required for MPP charge operations.');
  }
  return context.privateKey.startsWith('0x') ? context.privateKey : `0x${context.privateKey}`;
}
