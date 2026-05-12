declare module 'mppx-hedera' {
  export const HEDERA_STREAM_CHANNEL_TESTNET: string;
  export const HEDERA_STREAM_CHANNEL_MAINNET: string;
  export const USDC_TESTNET: string;
  export const USDC_MAINNET: string;
  export const VOUCHER_DOMAIN_NAME: string;
  export const VOUCHER_DOMAIN_VERSION: string;
  export const VOUCHER_TYPES: Record<string, Array<{ name: string; type: string }>>;
  export const hederaTestnet: import('viem').Chain;
  export const hederaMainnet: import('viem').Chain;
}

declare module 'mppx-hedera/client' {
  export function charge(options: {
    operatorId: string;
    operatorKey: string;
    network: string;
  }): {
    createCredential(params: { challenge: any }): Promise<string>;
  };

  export function hederaSession(options: {
    account: import('viem/accounts').Account;
    deposit: string;
    escrowContract?: string;
  }): {
    createCredential(params: { challenge: any }): Promise<string>;
  };
}
