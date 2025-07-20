import { expect } from '@playwright/test';
import { test } from '../fixtures.js';
import { startServer } from '../server.js';
import type { Server } from 'node:http';

let server: Server | null = null;

test.beforeEach(async () => {
  server = await startServer();
});

test.afterEach(async () => {
  if (server) {
    await new Promise((res) => server?.close(res));
    server = null;
  }
});

test('fetch data with mocked response', async ({ page, apiMock }) => {
  await apiMock.record();
  await page.goto('/');
  await expect(page.locator('#output')).toHaveText(
    '{"id":1,"name":"John Doe","email":"john@example.com","role":"admin"}',
  );
});

test('fetch data without mocking', async ({ page, apiMock }) => {
  await apiMock.record({ mock: false });
  await page.goto('/');
  await expect(page.locator('#output')).toHaveText(
    '{"id":1,"name":"John Doe","email":"john@example.com","role":"admin"}',
  );
});
