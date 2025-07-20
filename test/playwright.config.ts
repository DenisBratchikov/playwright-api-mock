import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'demo',
  fullyParallel: true,
  use: {
    // biome-ignore lint/style/useNamingConvention: Playwright uses baseURL
    baseURL: 'http://localhost:3000',
  },
});
