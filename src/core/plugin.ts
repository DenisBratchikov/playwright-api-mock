import type { Page, Request } from '@playwright/test';
import { SnapshotsStore } from './store';
import type {
	HookContext,
	Mode,
	PluginConfig,
	RuleConfig,
	SnapshotEntry,
	SnapshotKeyInput,
} from './types';
import {
	buildDefaultKey,
	ensureError,
	hashObject,
	normalizeUrlDefault,
	resolveMatch,
	stableStringify,
	variantToString,
} from './utils';

const DEFAULT_CONFIG: PluginConfig = {
	urlMatch: '**/*',
	storage: { type: 'file', path: 'api_snapshots.json' },
	logLevel: 'info',
	mode: 'auto',
	mock: true,
	urlNormalization: { orderQueryParams: true },
	keyStrategy: {
		includeBodyForMethods: ['POST', 'PUT', 'PATCH'],
		name: 'method-url-body',
	},
	onMismatch: 'warn',
};

const DEFAULT_ON_MISSING: Record<Mode, 'fail' | 'record' | 'passthrough'> = {
	record: 'record',
	mock: 'fail',
	auto: 'record',
};

/**
 * Create a deep-ish copy of snapshot bodies so transform hooks cannot mutate stored state.
 */
const cloneBody = (body: unknown): unknown => {
	if (body === undefined) return body;
	const stringified = stableStringify(body);
	return stringified === undefined ? undefined : JSON.parse(stringified);
};

/**
 * Narrow stored snapshot values to the structured v2 entry shape.
 */
const isSnapshotEntry = (value: unknown): value is SnapshotEntry => {
	return Boolean(value && typeof value === 'object' && 'response' in (value as Record<string, unknown>));
};

/**
 * Core Playwright plugin providing record & replay capabilities.
 */
export class ApiMockPlugin {
	private page: Page;
	private store: SnapshotsStore;
	private config: PluginConfig;

	constructor(page: Page, config?: Partial<PluginConfig>) {
		this.page = page;
		const resolved = this.mergeConfig(DEFAULT_CONFIG, config ?? {});
		this.config = resolved;
		this.store = new SnapshotsStore(resolved);
	}

	/**
	 * Merge default plugin options with per-invocation overrides without mutating the base config.
	 */
	private mergeConfig(base: PluginConfig, extra: Partial<PluginConfig>): PluginConfig {
		const storage = extra.storage ??
			base.storage ?? {
				type: 'file' as const,
				path: extra.apiSnapshotsPath ?? base.apiSnapshotsPath ?? 'api_snapshots.json',
			};

		const mode =
			extra.mode ?? (extra.mock === true ? 'mock' : extra.mock === false ? 'record' : undefined) ?? base.mode ?? 'auto';

		return {
			...base,
			...extra,
			mode,
			storage,
			urlNormalization: { ...base.urlNormalization, ...extra.urlNormalization },
			keyStrategy: { ...base.keyStrategy, ...extra.keyStrategy },
		};
	}

	/**
	 * Centralized logger to honor the configured log level.
	 */
	private log(message: string | Error) {
		if (this.config.logLevel === 'silent') {
			return;
		}

		if (message instanceof Error) {
			console.error(message);
		} else if (this.config.logLevel === 'info') {
			console.info(message);
		}
	}

	/**
	 * Predicate to decide if a request should be intercepted at all.
	 */
	private async shouldHandle(req: Request, config: PluginConfig) {
		if (config.shouldHandleRequest) {
			return await config.shouldHandleRequest(req);
		}
		return true;
	}

	/**
	 * Extract and parse the request body (used for hashing in keys).
	 */
	private async extractBody(req: Request, config: PluginConfig) {
		if (config.extractBody) {
			return await config.extractBody(req);
		}
		const raw = req.postData();
		if (!raw) return undefined;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}

	/**
	 * Resolve the active variant/persona for the given request, honoring rule-level overrides.
	 */
	private async resolveVariant(config: PluginConfig, rule: RuleConfig | undefined, context: HookContext) {
		if (rule?.resolveVariant) {
			return await rule.resolveVariant(context.request, context);
		}
		if (rule?.variant) {
			const variant = rule.variant;
			if (typeof variant === 'function') {
				return await variant(context.request, context);
			}
			return variant;
		}
		if (config.resolveVariant) {
			return await config.resolveVariant(context.request, context);
		}
		if (config.variant) {
			const variant = config.variant;
			if (typeof variant === 'function') {
				return await variant(context.request, context);
			}
			return variant;
		}
		return undefined;
	}

	/**
	 * Normalize URL per global config, then allow rule-specific overrides.
	 */
	private async normalizeUrl(rawUrl: string, config: PluginConfig, rule: RuleConfig | undefined, context: HookContext) {
		const normalized = normalizeUrlDefault(rawUrl, config.urlNormalization);
		const overridden =
			(rule?.normalizeUrl && (await rule.normalizeUrl(normalized, context))) ??
			(config.normalizeUrl && (await config.normalizeUrl(normalized, context)));
		return overridden ?? normalized;
	}

	/**
	 * Decide whether the request body should influence the snapshot key.
	 */
	private shouldIncludeBodyHash(method: string, config: PluginConfig) {
		const strategy = config.keyStrategy;
		if (!strategy) return false;
		if (strategy.includeBody) return true;
		const methods = strategy.includeBodyForMethods ?? ['POST', 'PUT', 'PATCH'];
		return methods.includes(method.toUpperCase());
	}

	/**
	 * Build the snapshot key using overrides (rule/keyFn) or the default strategy.
	 */
	private async resolveKey(input: SnapshotKeyInput, config: PluginConfig, rule?: RuleConfig): Promise<string> {
		if (rule?.key) {
			if (typeof rule.key === 'string') return rule.key;
			return await rule.key(input);
		}
		if (rule?.keyFn) {
			return await rule.keyFn(input);
		}
		if (config.keyFn) {
			return await config.keyFn(input);
		}
		return buildDefaultKey(input);
	}

	/**
	 * Find the first matching rule for the request.
	 */
	private findRule(config: PluginConfig, req: Request) {
		return Promise.all(
			(config.rules ?? []).map(async (rule) => ({ rule, matches: await resolveMatch(rule.match, req) })),
		).then((results) => results.find((r) => r.matches)?.rule);
	}

	/**
	 * Resolve the missing-snapshot behavior based on mode and overrides.
	 */
	private onMissingBehavior(config: PluginConfig) {
		return config.onMissingSnapshot ?? config.onMissingSnapshotBehavior ?? DEFAULT_ON_MISSING[config.mode];
	}

	/**
	 * Attach routing to begin record/mock/auto interception.
	 * This is the primary entry point invoked from tests/fixtures.
	 */
	async record(configOverwrite?: Partial<PluginConfig>): Promise<void> {
		const effectiveConfig = configOverwrite ? this.mergeConfig(this.config, configOverwrite) : this.config;
		const store = configOverwrite ? new SnapshotsStore(effectiveConfig) : this.store;

		await this.page.route(effectiveConfig.urlMatch, async (route) => {
			const request = route.request();
			const context: HookContext = { page: this.page, request, route, config: effectiveConfig };
			if (!(await this.shouldHandle(request, effectiveConfig))) {
				await route.continue();
				return;
			}

			const rule = await this.findRule(effectiveConfig, request);
			const normalizedUrl = await this.normalizeUrl(request.url(), effectiveConfig, rule, context);
			const variantValue = await this.resolveVariant(effectiveConfig, rule, context);
			const variant = variantToString(variantValue);
			const shouldHashBody = this.shouldIncludeBodyHash(request.method(), effectiveConfig);
			const requestBody = shouldHashBody ? await this.extractBody(request, effectiveConfig) : undefined;
			const bodyForHash =
				shouldHashBody && effectiveConfig.keyStrategy?.bodyFieldExtractor
					? effectiveConfig.keyStrategy.bodyFieldExtractor(requestBody)
					: requestBody;
			const bodyHash =
				shouldHashBody && bodyForHash !== undefined
					? (effectiveConfig.keyStrategy?.bodyHashFn?.(bodyForHash) ?? hashObject(bodyForHash))
					: undefined;

			const keyInput: SnapshotKeyInput = {
				method: request.method(),
				normalizedUrl,
				variant,
				bodyHash,
				url: request.url(),
			};
			const key = await this.resolveKey(keyInput, effectiveConfig, rule);

			const storedSnapshot = store.getStoredSnapshot(key, normalizedUrl);
			if (storedSnapshot) {
				const baseBody = isSnapshotEntry(storedSnapshot) ? storedSnapshot.response.body : storedSnapshot?.body;
				const transformedBody = rule?.onServeResponse
					? await rule.onServeResponse(cloneBody(baseBody), context)
					: baseBody;

				const status = isSnapshotEntry(storedSnapshot)
					? storedSnapshot.response.status
					: (storedSnapshot?.status ?? 200);
				const headers = isSnapshotEntry(storedSnapshot) ? storedSnapshot.response.headers : storedSnapshot?.headers;

				const bodyToSend =
					typeof transformedBody === 'string' || transformedBody === undefined
						? (transformedBody as string | undefined)
						: JSON.stringify(transformedBody);

				this.log(`[Mocked] ${key}`);
				await route.fulfill({
					status,
					headers,
					body: bodyToSend,
				});
				return;
			}

			const nearMatch = store.listEntries().find((entry) => entry.request.normalizedUrl === normalizedUrl);
			if (nearMatch && effectiveConfig.onMismatch === 'fail') {
				throw new Error(`Snapshot mismatch for ${key}; found different key ${nearMatch.key}`);
			}
			if (nearMatch && effectiveConfig.onMismatch === 'warn') {
				this.log(`Snapshot mismatch for ${key}; closest match ${nearMatch.key}`);
			}

			const onMissing = this.onMissingBehavior(effectiveConfig);
			if (onMissing === 'fail') {
				const message = `Missing snapshot for ${key}`;
				this.log(message);
				throw new Error(message);
			}
			if (onMissing === 'passthrough') {
				this.log(`[Passthrough] ${key}`);
				await route.continue();
				return;
			}

			try {
				const response = await route.fetch();
				const responseBuffer = await response.body();
				const rawHeaders = response.headers();
				const filteredHeaders =
					effectiveConfig.normalizeHeaders?.(rawHeaders) ?? effectiveConfig.getStoredHeaders?.(rawHeaders);
				const contentType = rawHeaders['content-type'] ?? '';
				let parsedBody: unknown = responseBuffer.toString('utf-8');
				if (contentType.includes('application/json')) {
					try {
						parsedBody = JSON.parse(parsedBody as string);
					} catch {
						parsedBody = responseBuffer.toString('utf-8');
					}
				}

				const bodyForStorage = rule?.onRecordResponse
					? await rule.onRecordResponse(cloneBody(parsedBody), context)
					: parsedBody;

				const snapshot: SnapshotEntry = {
					key,
					request: {
						url: request.url(),
						normalizedUrl,
						method: request.method(),
						bodyHash: bodyHash,
						variant,
					},
					response: {
						status: response.status(),
						headers: filteredHeaders,
						body: bodyForStorage,
					},
					meta: {
						recordedAt: new Date().toISOString(),
						keyStrategy: effectiveConfig.keyStrategy?.name ?? 'method-url-body',
						normalization: effectiveConfig.urlNormalization ?? {},
						variant,
					},
				};

				store.saveEntry(snapshot);
				this.log(`[Recorded] ${key}`);

				await route.fulfill({
					status: response.status(),
					headers: rawHeaders,
					body: responseBuffer,
				});
			} catch (e) {
				this.log(ensureError(e));
				await route.continue();
			}
		});
	}
}
