import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import type { Request } from '@playwright/test';
import type { SnapshotKeyInput, UrlNormalizationRules, Variant } from './types';

/**
 * Ensures we always work with Error instances.
 */
export const ensureError = (e: unknown) => (e instanceof Error ? e : new Error(`${e}`));

/**
 * Deterministic JSON stringifier that orders object keys.
 */
export const stableStringify = (value: unknown): string => {
	const seen = new WeakSet();
	const stringify = (input: unknown): string => {
		if (input === null || typeof input !== 'object') {
			return JSON.stringify(input);
		}

		if (seen.has(input as object)) {
			return '"[circular]"';
		}
		seen.add(input as object);

		if (Array.isArray(input)) {
			return `[${input.map((item) => stringify(item)).join(',')}]`;
		}

		const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
		const body = entries.map(([key, val]) => `${JSON.stringify(key)}:${stringify(val)}`).join(',');
		return `{${body}}`;
	};

	return stringify(value);
};

/**
 * Stable hash of any JSON-like value.
 */
export const hashObject = (value: unknown): string => {
	const hash = createHash('sha256');
	hash.update(stableStringify(value));
	return hash.digest('hex');
};

/**
 * Atomic file writer to avoid partial writes.
 */
export const atomicWriteFile = (path: string, content: string) => {
	fs.mkdirSync(dirname(path), { recursive: true });
	const tmpPath = join(dirname(path), `.tmp-${randomUUID()}`);
	fs.writeFileSync(tmpPath, content);
	fs.renameSync(tmpPath, path);
};

/**
 * Default URL normalization including query filtering and ordering.
 */
export const normalizeUrlDefault = (url: string, rules: UrlNormalizationRules = {}): string => {
	const parsed = new URL(url);
	let pathname = parsed.pathname;

	for (const rewrite of rules.pathRewriters ?? []) {
		pathname = pathname.replace(rewrite.pattern, rewrite.replace);
	}

	if (rules.stripQuery) {
		return `${parsed.origin}${pathname}`;
	}

	const search = new URLSearchParams(parsed.search);
	if (rules.includeQueryParams && rules.includeQueryParams.length > 0) {
		for (const key of Array.from(search.keys())) {
			if (!rules.includeQueryParams.includes(key)) {
				search.delete(key);
			}
		}
	}

	if (rules.excludeQueryParams && rules.excludeQueryParams.length > 0) {
		for (const key of rules.excludeQueryParams) {
			search.delete(key);
		}
	}

	const buildQuery = (params: URLSearchParams) => {
		if (rules.orderQueryParams === false) {
			return params.toString();
		}

		const sorted = new URLSearchParams();
		for (const key of Array.from(new Set(params.keys())).sort()) {
			const values = params.getAll(key).sort();
			for (const val of values) {
				sorted.append(key, val);
			}
		}
		return sorted.toString();
	};

	const query = buildQuery(search);
	return `${parsed.origin}${pathname}${query ? `?${query}` : ''}`;
};

/**
 * Evaluate whether a route rule matches the request.
 */
export const resolveMatch = async (
	match: RegExp | string | ((req: Request) => boolean | Promise<boolean>),
	req: Request,
) => {
	if (match instanceof RegExp) {
		return match.test(req.url());
	}
	if (typeof match === 'string') {
		return req.url().includes(match);
	}
	return await match(req);
};

/**
 * Default snapshot key builder: METHOD + normalized URL (+ variant/body hash).
 */
export const buildDefaultKey = (input: SnapshotKeyInput): string => {
	const base = `${input.method.toUpperCase()} ${input.normalizedUrl}`;
	const suffix: string[] = [];
	if (input.variant) {
		suffix.push(`variant=${input.variant}`);
	}
	if (input.bodyHash) {
		suffix.push(`body=${input.bodyHash}`);
	}
	return suffix.length > 0 ? `${base} | ${suffix.join(' | ')}` : base;
};

/**
 * Deterministic variant stringifier for use in keys.
 */
export const variantToString = (variant: Variant | undefined): string | undefined => {
	if (variant === undefined) return undefined;
	if (typeof variant === 'string') return variant;
	if (typeof variant === 'number' || typeof variant === 'boolean') return String(variant);
	return stableStringify(variant);
};
