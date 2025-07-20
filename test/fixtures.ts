import { test as base } from '@playwright/test';
import { ApiMockPlugin } from '../dist/index.js';

export const test = base.extend<{ apiMock: ApiMockPlugin }>({
  apiMock: async ({ page }, use) => {
    const plugin = new ApiMockPlugin(page, {
      urlMatch: '**/api/**',
      apiSnapshotsPath: '__snapshots__/api.json',
      logLevel: 'info',
    });
    await use(plugin);
  },
});
