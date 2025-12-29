import { ApiMockPlugin } from '../src/index';
import { test, expect } from 'bun:test';
import type { Page, Route, Request, APIResponse } from '@playwright/test';
import type { StoredSnapshots } from '../src/core/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type FulfillOptions = Parameters<Route['fulfill']>[0];

class MockRequest implements Request {
	constructor(private targetUrl: string, private targetMethod = 'GET', private body?: string) {}

	url(): string {
		return this.targetUrl;
	}

	method(): string {
		return this.targetMethod;
	}

	postData(): string | null {
		return this.body ?? null;
	}
	// unused
	abort() {}
	headers() {
		return {};
	}
	isNavigationRequest(): boolean {
		return false;
	}
	// @ts-ignore - unused members
	authentication() {}
	// @ts-ignore - unused members
	failure() {}
	// @ts-ignore - unused members
	frame() {}
	// @ts-ignore - unused members
	headerValue() { return null; }
	// @ts-ignore - unused members
	postDataBuffer() { return undefined; }
	// @ts-ignore - unused members
	postDataJSON() { return undefined; }
	// @ts-ignore - unused members
	redirectedFrom() { return null; }
	// @ts-ignore - unused members
	resourceType() { return 'xhr'; }
	// @ts-ignore - unused members
	response() { return null; }
	// @ts-ignore - unused members
	timing() { return { startTime: 0 }; }
}

class MockAPIResponse implements APIResponse {
	private buffer: Buffer;
	constructor(
		body: unknown,
		private statusCode = 200,
		private responseHeaders: Record<string, string> = {
			'content-type': 'application/json',
		},
	) {
		if (Buffer.isBuffer(body)) {
			this.buffer = body;
		} else if (typeof body === 'string') {
			this.buffer = Buffer.from(body);
		} else {
			this.buffer = Buffer.from(JSON.stringify(body));
		}
	}
	async body(): Promise<Buffer> {
		return this.buffer;
	}
	headers() {
		return this.responseHeaders;
	}
	status() {
		return this.statusCode;
	}
	// unused
	url(): string {
		return '';
	}
	// @ts-ignore - unused members
	ok() { return true; }
	// @ts-ignore - unused members
	statusText() { return ''; }
	// @ts-ignore - unused members
	securityDetails() { return null; }
	// @ts-ignore - unused members
	request() { return null; }
	// @ts-ignore - unused members
	frame() { return null; }
	// @ts-ignore - unused members
	serverAddr() { return null; }
	// @ts-ignore - unused members
	finished() { return Promise.resolve(undefined); }
}

class MockRoute implements Route {
	fulfilledWith?: FulfillOptions;
	continued = false;
	fetchCalled = false;

	constructor(private req: MockRequest, private fetchResponse: APIResponse) {}

	request(): Request {
		return this.req;
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

	// unused
	async abort(): Promise<void> {}
	async fallback(): Promise<void> {}
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

test('generates stable keys with normalized url, variant, and body hash', async () => {
	const dir = createTempDir();
	const file = join(dir, 'snap.json');

	const page = new MockPage();
	const plugin = new ApiMockPlugin(page as unknown as Page, {
		storage: { type: 'file', path: file },
		urlMatch: '**/*',
		logLevel: 'silent',
		variant: 'pro',
		urlNormalization: {
			excludeQueryParams: ['t'],
			orderQueryParams: true,
			pathRewriters: [{ pattern: /\d+/, replace: ':id' }],
		},
		keyStrategy: { includeBodyForMethods: ['POST'], name: 'method-url-body' },
	});

	await plugin.record();
	const response = new MockAPIResponse({ ok: true });
	const route = new MockRoute(
		new MockRequest('http://example.com/users/123?a=1&b=2&t=drop', 'POST', '{"b":1,"a":2}'),
		response,
	);
	await page.trigger(route);

	// @ts-expect-error access for testing
	const entries = plugin.store.listEntries();
	expect(entries[0].key).toBe('POST http://example.com/users/:id?a=1&b=2 | variant=pro | body=d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772');

	rmSync(dir, { recursive: true, force: true });
});

test('rule overrides key, variant, and response transformation', async () => {
	const dir = createTempDir();
	const file = join(dir, 'snap.json');
	const page = new MockPage();
	const plugin = new ApiMockPlugin(page as unknown as Page, {
		storage: { type: 'file', path: file },
		urlMatch: '**/*',
		logLevel: 'silent',
		rules: [
			{
				match: 'secure',
				key: 'custom-key',
				variant: 'free',
				onRecordResponse: (body) => {
					const clone = body as Record<string, unknown>;
					delete clone.secret;
					return clone;
				},
				onServeResponse: (body) => ({ ...((body as Record<string, unknown>) ?? {}), served: true }),
			},
		],
	});

	await plugin.record();
	const response = new MockAPIResponse({ data: 1, secret: 'x' });
	const route = new MockRoute(new MockRequest('http://example.com/secure'), response);
	await page.trigger(route);

	// @ts-expect-error access store for testing
	const entry = plugin.store.listEntries()[0];
	expect(entry.key).toBe('custom-key');
	expect(entry.request.variant).toBe('free');
	expect(entry.response.body).toEqual({ data: 1 });

	// Trigger mock replay
	const replayRoute = new MockRoute(new MockRequest('http://example.com/secure'), response);
	await page.trigger(replayRoute);
	expect(replayRoute.fulfilledWith?.body).toBe(JSON.stringify({ data: 1, served: true }));

	rmSync(dir, { recursive: true, force: true });
});

test('mode behaviors: mock fails on missing, auto records, record stores snapshots', async () => {
	const dir = createTempDir();
	const file = join(dir, 'snap.json');

	const page = new MockPage();
	const plugin = new ApiMockPlugin(page as unknown as Page, {
		storage: { type: 'file', path: file },
		urlMatch: '**/*',
		logLevel: 'silent',
		mode: 'mock',
	});

	await plugin.record();
	const response = new MockAPIResponse({ ok: true });
	const route = new MockRoute(new MockRequest('http://example.com/missing'), response);
	await expect(page.trigger(route)).rejects.toThrow('Missing snapshot');

	// auto mode should record
	const autoPlugin = new ApiMockPlugin(page as unknown as Page, {
		storage: { type: 'file', path: file },
		urlMatch: '**/*',
		logLevel: 'silent',
		mode: 'auto',
	});
	await autoPlugin.record();
	const autoRoute = new MockRoute(new MockRequest('http://example.com/auto'), response);
	await page.trigger(autoRoute);
	// @ts-expect-error test access
	expect(autoPlugin.store.listEntries().length).toBe(1);

	// record mode always records
	const recordPlugin = new ApiMockPlugin(page as unknown as Page, {
		storage: { type: 'file', path: join(dir, 'rec.json') },
		urlMatch: '**/*',
		logLevel: 'silent',
		mode: 'record',
	});
	await recordPlugin.record();
	const recordRoute = new MockRoute(new MockRequest('http://example.com/record'), response);
	await page.trigger(recordRoute);
	// @ts-expect-error test access
	expect(recordPlugin.store.listEntries()[0].request.url).toContain('record');

	rmSync(dir, { recursive: true, force: true });
});
