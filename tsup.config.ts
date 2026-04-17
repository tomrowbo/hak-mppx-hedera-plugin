import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false, // Zod v3 (agent-kit) vs v4 (mppx) type mismatch — skip dts for now
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
  ],
});
