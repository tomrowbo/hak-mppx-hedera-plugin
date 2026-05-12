import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    '@hashgraph/hedera-agent-kit',
    '@hiero-ledger/sdk',
    'mppx',
    'mppx-hedera',
    'mppx-hedera/client',
    'mppx-hedera/server',
    'viem',
    'viem/accounts',
    'zod',
    'zod/v3',
  ],
});
