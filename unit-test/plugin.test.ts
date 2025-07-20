import { ApiMockPlugin } from '../src/index';
import { test, expect } from 'bun:test';

class MockRoute {
  fulfilledWith?: any;
  continued = false;
  fetchCalled = false;

  constructor(private url: string, private fetchResponse: any) {}

  request() {
    return { url: () => this.url } as any;
  }

  async fetch() {
    this.fetchCalled = true;
    return this.fetchResponse;
  }

  async fulfill(opts: any) {
    this.fulfilledWith = opts;
  }

  async continue() {
    this.continued = true;
  }
}

class MockPage {
  handler?: (route: MockRoute) => Promise<void>;

  async route(_match: any, cb: any) {
    this.handler = cb;
  }

  async trigger(route: MockRoute) {
    if (this.handler) {
      await this.handler(route as any);
    }
  }
}

test('uses stored snapshot when available', async () => {
  const page = new MockPage();
  const plugin = new ApiMockPlugin(page as any, {
    apiSnapshotsPath: 'file',
    urlMatch: '**/*',
    logLevel: 'silent',
  });

  const snapshot = { status: 200, headers: { a: 'b' }, body: { ok: true } };
  // @ts-ignore override private field
  plugin.store = {
    getStoredSnapshot: () => snapshot,
    storeResponse: async () => {},
  } as any;

  await plugin.record();
  const mockResp = { json: async () => ({}), status: () => 200, headers: () => ({}) };
  const route = new MockRoute('http://example.com', mockResp);
  await page.trigger(route);
  expect(route.fulfilledWith?.status).toBe(200);
  expect(route.continued).toBe(false);
});

test('records new responses when not stored', async () => {
  const page = new MockPage();
  const plugin = new ApiMockPlugin(page as any, {
    apiSnapshotsPath: 'file',
    urlMatch: '**/*',
    logLevel: 'silent',
  });

  let storedKey: string | undefined;
  // @ts-ignore override private field
  plugin.store = {
    getStoredSnapshot: () => undefined,
    storeResponse: async (key: string) => {
      storedKey = key;
    },
  } as any;

  await plugin.record();
  const response = { json: async () => ({ a: 1 }), status: () => 201, headers: () => ({}) };
  const route = new MockRoute('http://api', response);
  await page.trigger(route);
  expect(route.fetchCalled).toBe(true);
  expect(route.continued).toBe(true);
  expect(storedKey).toBe('http://api');
});
