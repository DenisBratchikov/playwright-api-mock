import { expect } from '@playwright/test';
import { test } from '../fixtures.js';

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
