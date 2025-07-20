import { test as base } from '@playwright/test';
import { ApiMockPlugin } from '../dist/index.js';

export const test = base.extend({
  page: async ({ page }, use) => {
    const apiMock = new ApiMockPlugin(page, {
      urlMatch: '**/api/**',
      apiSnapshotsPath: '__snapshots__/api.json',
      logLevel: 'info',
    });
    await apiMock.record();
    await use(page);
  },
});
