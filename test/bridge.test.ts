import { describe, it, expect } from 'vitest';
import {
  clientToViemAccount,
  getOperatorId,
  getOperatorKey,
  resolveChain,
} from '../src/bridge.js';

/**
 * Create a mock Hiero SDK Client with optional operator key and account ID.
 * The real Client stores these as objects with toString/toStringRaw methods.
 */
function mockClient(rawKey?: string, accountId?: string) {
  return {
    operatorAccountKey: rawKey ? { toStringRaw: () => rawKey } : undefined,
    operatorAccountId: accountId ? { toString: () => accountId } : undefined,
  };
}

describe('bridge', () => {
  describe('clientToViemAccount', () => {
    it('extracts ECDSA key and returns account with correct address', () => {
      // 32-byte hex key (secp256k1 private key)
      const rawKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const client = mockClient(rawKey);
      const account = clientToViemAccount(client as any);

      expect(account).toBeDefined();
      expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // This is the well-known Hardhat #0 address for this key
      expect(account.address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    });

    it('throws when no operator key is present', () => {
      const client = mockClient(undefined, '0.0.12345');
      expect(() => clientToViemAccount(client as any)).toThrow(
        'Cannot extract operator key',
      );
    });
  });

  describe('getOperatorId', () => {
    it('returns account ID string', () => {
      const client = mockClient('ab'.repeat(32), '0.0.98765');
      expect(getOperatorId(client as any)).toBe('0.0.98765');
    });

    it('throws when no operator account ID is present', () => {
      const client = mockClient('ab'.repeat(32));
      expect(() => getOperatorId(client as any)).toThrow(
        'Cannot extract operator account ID',
      );
    });
  });

  describe('getOperatorKey', () => {
    it('returns 0x-prefixed hex string', () => {
      const rawKey = 'ab'.repeat(32);
      const client = mockClient(rawKey, '0.0.12345');
      const result = getOperatorKey(client as any);
      expect(result).toBe(`0x${rawKey}`);
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe('resolveChain', () => {
    it('returns testnet chain when network is undefined or "testnet"', () => {
      const chain1 = resolveChain();
      const chain2 = resolveChain('testnet');
      expect(chain1).toBe(chain2);
      expect(chain1.name).toBeDefined();
    });

    it('returns mainnet chain when network is "mainnet"', () => {
      const mainnet = resolveChain('mainnet');
      const testnet = resolveChain('testnet');
      expect(mainnet).not.toBe(testnet);
    });
  });
});
