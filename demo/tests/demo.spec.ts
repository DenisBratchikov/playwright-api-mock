import { expect } from '@playwright/test';
import { test } from './fixtures';
import { startServer } from './server.js';
import type { Server } from 'http';

let server: Server;

// Start a simple backend before all tests
test.beforeAll(async () => {
  server = await startServer();
});

// Stop the backend after tests complete
test.afterAll(async () => {
  await new Promise((res) => server.close(res));
});

// This test demonstrates using ApiMockPlugin with the running server

test('fetch data from example API', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#output')).toHaveText('{"id":1,"name":"John Doe"}');
});
