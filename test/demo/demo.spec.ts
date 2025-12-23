import { expect } from '@playwright/test';
import { test } from '../fixtures.js';
import { startServer } from '../server.js';

let server: any;

test.beforeAll(async () => {
  server = await startServer(3000);
});

test.afterAll(async () => {
  await server?.close();
});

test('records and replays variant snapshots for users and subscription endpoints', async ({ page, apiMock }) => {
  process.env.USER_TIER = 'Expert';
  await apiMock.record();
  await page.goto('/?tier=Expert');
  await expect(page.locator('#user')).toHaveText(
    '{"id":1,"name":"Dr. Jane","email":"john@example.com","tier":"Expert"}',
  );
  await expect(page.locator('#plan')).toHaveText('{"plan":"Expert","limits":"premium"}');

  process.env.USER_TIER = 'Free';
  await apiMock.record();
  await page.goto('/?tier=Free');
  await expect(page.locator('#user')).toHaveText(
    '{"id":1,"name":"John Doe","email":"john@example.com","tier":"Free"}',
  );
  await expect(page.locator('#plan')).toHaveText('{"plan":"Free","limits":"basic"}');

  // Switch to mock mode and ensure variant selection comes from snapshots
  await apiMock.record({ mode: 'mock' });
  process.env.USER_TIER = 'Expert';
  await page.goto('/?tier=Expert');
  await expect(page.locator('#plan')).toHaveText('{"plan":"Expert","limits":"premium"}');
});
