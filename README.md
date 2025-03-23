# Playwright API Recorder
> A Playwright plugin for seamlessly recording and mocking API responses, accelerating your testing workflow.

## 🚀 Features
- **Automatic API recording** into snapshot files.
- **Instant response mocking** from saved snapshots for faster tests.
- **Flexible request matching** (wildcards & regular expressions).
- **Configurable logging** (`silent`, `error`, `info` levels).
- **Easy integration** with Playwright’s fixture system.

## 📦 Installation

```shell
npm add -D playwright-api-mock
```

## 🛠️ Usage

### ✅ Automatically Record and Mock API Responses

Extend Playwright’s page fixture to automatically record and mock API calls:

```typescript
// fixtures.ts
import { test as base } from '@playwright/test';
import { ApiMockPlugin } from 'playwright-api-mock';

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
```

Then, simply use your extended fixture in tests:

```typescript
import { test, expect } from './fixtures';

test('Fetch user data', async ({ page }) => {
  await page.goto('/users/123');
  const text = await page.locator('body').textContent();
  expect(text).toContain('User');
});
```

---

### 🔧 Create a Custom Fixture

Alternatively, create a standalone API mock fixture for flexible usage:

```typescript
import { test as base } from '@playwright/test';
import { ApiMockPlugin } from 'playwright-api-mock';

export const test = base.extend({
  apiMock: async ({ page }, use) => {
    const plugin = new ApiMockPlugin(page);
    await use(plugin);
  },
});
```

Then use it explicitly in your tests:

```typescript
import { test, expect } from './fixtures';

test.describe('User Page', () => {
  test.beforeEach(async ({ apiMock }) => {
    await apiMock.record({
      urlMatch: '**/api/user/**',
      apiSnapshotsPath: '__snapshots__/userApi.json',
    });
  });

  test('Load user data', async ({ page }) => {
    await page.goto('/users/123');
    const text = await page.locator('body').textContent();
    expect(text).toContain('User');
  });
});
```

## ⚙️ Configuration

Customize your plugin by passing an options object:

```typescript
const apiMock = new ApiMockPlugin(page, {
  urlMatch: '**/api/**',
  apiSnapshotsPath: '__snapshots__/api.json',
  logLevel: 'info',
  getStoredHeaders: (headers) => {
    // optionally filter or modify headers before storing
    return { 'content-type': headers['content-type'] };
  },
});
```

### PluginConfig interface

| Option             | Type                                 | Default              | Description                                      |
|--------------------|--------------------------------------|----------------------|--------------------------------------------------|
| `urlMatch`         | `string \| RegExp`                   | `**/*`               | Request URLs to record/mock                      |
| `apiSnapshotsPath` | `string`                             | `api_snapshots.json` | Path to store/load snapshot files                |
| `logLevel`         | `'silent' \| 'error' \| 'info'`      | `'info'`             | Level of logging detail                          |
| `getStoredHeaders` | `(headers) => headers \| undefined`  | `undefined`          | Function to modify or filter headers before saving|

---

## 📖 API Methods

### `record(config?: Partial<PluginConfig>): Promise<void>`

Starts intercepting and recording API responses. Optionally override configuration per test or fixture.

## 📜 License

MIT License. See LICENSE for details.
