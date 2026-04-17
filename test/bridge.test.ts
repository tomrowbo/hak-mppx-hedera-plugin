import { describe, it, expect } from 'vitest';
import {
  contextToViemAccount,
  getOperatorId,
  getPrivateKey,
  resolveChain,
} from '../src/bridge.js';
import type { MppxContext } from '../src/bridge.js';

function mockClient(accountId?: string) {
  return {
    operatorAccountId: accountId ? { toString: () => accountId } : undefined,
  };
}

describe('bridge', () => {
  describe('contextToViemAccount', () => {
    it('creates viem account from context privateKey', () => {
      const rawKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const context: MppxContext = { privateKey: `0x${rawKey}` };
      const account = contextToViemAccount(context);

      expect(account).toBeDefined();
      expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(account.address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    });

    it('throws when no privateKey in context', () => {
      const context: MppxContext = {};
      expect(() => contextToViemAccount(context)).toThrow('context.privateKey is required');
    });
  });

  describe('getOperatorId', () => {
    it('returns account ID string', () => {
      const client = mockClient('0.0.98765');
      expect(getOperatorId(client as any)).toBe('0.0.98765');
    });

    it('throws when no operator account ID', () => {
      const client = mockClient();
      expect(() => getOperatorId(client as any)).toThrow('Cannot extract operator account ID');
    });
  });

  describe('getPrivateKey', () => {
    it('returns 0x-prefixed hex from context', () => {
      const context: MppxContext = { privateKey: '0x' + 'ab'.repeat(32) };
      expect(getPrivateKey(context)).toBe('0x' + 'ab'.repeat(32));
    });

    it('adds 0x prefix if missing', () => {
      const context: MppxContext = { privateKey: 'ab'.repeat(32) };
      expect(getPrivateKey(context)).toBe('0x' + 'ab'.repeat(32));
    });

    it('throws when no privateKey', () => {
      const context: MppxContext = {};
      expect(() => getPrivateKey(context)).toThrow('context.privateKey is required');
    });
  });

  describe('resolveChain', () => {
    it('returns testnet for "testnet"', () => {
      expect(resolveChain('testnet').id).toBe(296);
    });

    it('returns mainnet for "mainnet"', () => {
      expect(resolveChain('mainnet').id).toBe(295);
    });

    it('defaults to testnet', () => {
      expect(resolveChain().id).toBe(296);
      expect(resolveChain(undefined).id).toBe(296);
    });
  });
});
