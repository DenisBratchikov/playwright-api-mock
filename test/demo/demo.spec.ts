import { expect } from '@playwright/test';
import { test } from '../fixtures.js';
import { startServer } from '../server.js';
import type { Server } from 'node:http';

let server: Server | null = null;

// This test demonstrates using ApiMockPlugin with the running server
test('fetch data from example API', async ({ page }) => {
  // Start server if not already running
  if (!server) {
    server = await startServer();
  }

  try {
    await page.goto('/');
    await expect(page.locator('#output')).toHaveText('{"id":1,"name":"John Doe"}');
  } finally {
    // Clean up server after test
    const currentServer = server;
    if (currentServer) {
      await new Promise((res) => currentServer.close(res));
      server = null;
    }
  }
});
