import { ApiMockPlugin } from '../src/index';
import { test, expect } from 'bun:test';
import type { Page, Route, Request, Response, APIResponse } from '@playwright/test';
import type { StoredSnapshots } from '../src/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type FulfillOptions = Parameters<Route['fulfill']>[0];

interface MockStore {
	getStoredSnapshot(key: string): StoredSnapshots[string] | undefined;
	storeResponse(key: string, response: Response): Promise<void>;
}

class MockRoute implements Route {
	fulfilledWith?: FulfillOptions;
	continued = false;
	fetchCalled = false;

	constructor(private url: string, private fetchResponse: APIResponse) {}

	request(): Request {
		return { url: () => this.url } as Request;
	}

	async fetch(): Promise<APIResponse> {
		this.fetchCalled = true;
		return this.fetchResponse as APIResponse;
	}

	async fulfill(opts: FulfillOptions): Promise<void> {
		this.fulfilledWith = opts;
	}

	async continue(): Promise<void> {
		this.continued = true;
	}

	async abort(): Promise<void> {
		// do nothing
	}

	async fallback(): Promise<void> {
		// do nothing
	}
}

class MockPage {
	handler?: (route: Route) => Promise<void>;

	async route(_match: string | RegExp, cb: (route: Route) => Promise<void>): Promise<void> {
		this.handler = cb;
	}

	async trigger(route: MockRoute): Promise<void> {
		if (this.handler) {
			await this.handler(route);
		}
	}
}

function createTempDir() {
	return mkdtempSync(join(tmpdir(), 'plugin-'));
}

test('uses stored snapshot when available', async () => {
	const dir = createTempDir();
	const file = join(dir, 'snap.json');

	const page = new MockPage();
	const plugin = new ApiMockPlugin(page as unknown as Page, {
		apiSnapshotsPath: file,
		urlMatch: '**/*',
		logLevel: 'silent',
	});

	const snapshot: StoredSnapshots[string] = { status: 200, headers: { a: 'b' }, body: { ok: true } };
	const mockStore: MockStore = {
		getStoredSnapshot: () => snapshot,
		storeResponse: async () => {},
	};
	// @ts-expect-error override private field for testing
	plugin.store = mockStore;

	await plugin.record();
	const mockResp = { json: async () => ({}), status: () => 200, headers: () => ({}) } as APIResponse;
	const route = new MockRoute('http://example.com', mockResp);
	await page.trigger(route);
	expect(route.fulfilledWith?.status).toBe(200);
	expect(route.continued).toBe(false);

	rmSync(dir, { recursive: true, force: true });
});

test('records new responses when not stored', async () => {
	const dir = createTempDir();
	const file = join(dir, 'snap.json');

	const page = new MockPage();
	const plugin = new ApiMockPlugin(page as unknown as Page, {
		apiSnapshotsPath: file,
		urlMatch: '**/*',
		logLevel: 'silent',
	});

	let storedKey: string | undefined;
	const mockStore: MockStore = {
		getStoredSnapshot: () => undefined,
		storeResponse: async (key: string) => {
			storedKey = key;
		},
	};
	// @ts-expect-error override private field for testing
	plugin.store = mockStore;

	await plugin.record();
	const response = { json: async () => ({ a: 1 }), status: () => 201, headers: () => ({}) } as APIResponse;
	const route = new MockRoute('http://api', response);
	await page.trigger(route);
	expect(route.fetchCalled).toBe(true);
	expect(route.continued).toBe(true);
	expect(storedKey).toBe('http://api');

	rmSync(dir, { recursive: true, force: true });
});
