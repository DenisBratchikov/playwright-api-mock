import { test as base } from '@playwright/test';
import { ApiMockPlugin } from '../dist/index.js';

export const test = base.extend<{ apiMock: ApiMockPlugin }>({
  apiMock: async ({ page }, use) => {
    const plugin = new ApiMockPlugin(page, {
      urlMatch: '**/api/**',
      storage: { type: 'dir', path: '__snapshots__/api' },
      logLevel: 'info',
      mode: 'auto',
      variant: () => process.env.USER_TIER ?? 'Free',
      resolveVariant: (req) => (req.url().includes('users/me') ? process.env.USER_TIER ?? 'Free' : undefined),
      urlNormalization: { stripQuery: true },
    });
    await use(plugin);
  },
});
