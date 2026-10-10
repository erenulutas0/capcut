import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { Response } from 'miniflare';
import { defineConfig } from 'vitest/config';

import { MOCK_KEY, createOutboundService } from './test/mock-upstream.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// The Worker runs inside workerd (the real runtime) with its real Durable Object.
// The provider is the local fake in test/mock-upstream.mjs: every outgoing request
// of the Worker is handed to it, so the tests have no network.
export default defineConfig({
  root: here,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: join(here, 'wrangler.jsonc') },
      miniflare: {
        outboundService: createOutboundService(Response),
        bindings: {
          ENABLED: 'true',
          MONTHLY_CAP_USD: '1',
          PRICE_USD_PER_HOUR: '0.23',
          RATE_LIMIT_PER_HOUR: '30',
          ALLOWED_ORIGINS: 'https://erenulutas0.github.io,http://localhost:3000',
          PROVIDER_BASE_URL_OVERRIDE: 'http://provider.mock',
          ASSEMBLYAI_API_KEY: MOCK_KEY,
          ADMIN_TOKEN: 'test-admin-token-0123456789abcdef',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
