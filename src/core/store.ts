import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import type { APIResponse } from '@playwright/test';
import type { LegacySnapshotFile, SnapshotEntry, SnapshotFile, StoreConfig } from './types';
import { atomicWriteFile } from './utils';

const SNAPSHOT_VERSION = 2;

const ensureDir = (path: string) => {
	fs.mkdirSync(path, { recursive: true });
};

const readJson = (path: string): unknown => JSON.parse(fs.readFileSync(path, 'utf-8'));

/**
 * Snapshot storage supporting single-file and directory layouts.
 */
export class SnapshotsStore {
	private storagePath: string;
	private storageType: StoreConfig['storage']['type'];
	private getStoredHeaders: StoreConfig['getStoredHeaders'];
	private entries: Record<string, SnapshotEntry> = {};
	private legacySnapshots?: LegacySnapshotFile;
	private directoryIndex: Record<string, string> = {};

	constructor(params: StoreConfig) {
		const storage = params.storage ?? {
			type: 'file' as const,
			path: params.apiSnapshotsPath ?? 'api_snapshots.json',
		};
		this.storagePath = storage.path ?? params.apiSnapshotsPath ?? 'api_snapshots.json';
		this.storageType = storage.type;
		this.getStoredHeaders = params.getStoredHeaders;

		if (this.storageType === 'file') {
			if (fs.existsSync(this.storagePath)) {
				const parsed = readJson(this.storagePath);
				if (isSnapshotFile(parsed)) {
					this.entries = parsed.entries ?? {};
				} else if (parsed && typeof parsed === 'object') {
					this.legacySnapshots = parsed as LegacySnapshotFile;
					this.entries = SnapshotsStore.migrateLegacySnapshots(this.legacySnapshots, {
						method: 'GET',
					}).entries;
				}
			} else {
				fs.mkdirSync(dirname(this.storagePath), { recursive: true });
				this.entries = {};
			}
		} else {
			ensureDir(this.storagePath);
			for (const file of fs.readdirSync(this.storagePath)) {
				if (!file.endsWith('.json')) continue;
				const full = join(this.storagePath, file);
				const parsed = readJson(full);
				if (isSnapshotFile(parsed)) {
					for (const [key, entry] of Object.entries(parsed.entries)) {
						this.entries[key] = entry;
						this.directoryIndex[key] = full;
					}
				} else if (isSnapshotEntryWrapper(parsed)) {
					this.entries[parsed.entry.key] = parsed.entry;
					this.directoryIndex[parsed.entry.key] = full;
				}
			}
		}
	}

	/**
	 * Retrieve a snapshot by key, falling back to legacy layout if present.
	 */
	getStoredSnapshot(key: string, legacyKey?: string) {
		return this.entries[key] ?? this.legacySnapshots?.[legacyKey ?? key];
	}

	/**
	 * Enumerate stored snapshot entries.
	 */
	listEntries(): SnapshotEntry[] {
		return Object.values(this.entries);
	}

	/**
	 * Store a response in the snapshot store (record mode).
	 */
	async storeResponse(key: string, response: APIResponse, entry: Omit<SnapshotEntry, 'response'>) {
		const headers = this.getStoredHeaders?.(response.headers());
		const contentType = response.headers()['content-type'] ?? '';
		let body: unknown;
		if (contentType.includes('application/json')) {
			body = await response.json();
		} else {
			body = await response.text();
		}

		const snapshot: SnapshotEntry = {
			...entry,
			response: {
				status: response.status(),
				headers,
				body,
			},
		};

		this.entries[key] = snapshot;
		if (this.storageType === 'file') {
			this.writeToFile();
		} else {
			this.writeToDirectory(snapshot);
		}
	}

	/**
	 * Save a prepared snapshot entry.
	 */
	saveEntry(snapshot: SnapshotEntry) {
		this.entries[snapshot.key] = snapshot;
		if (this.storageType === 'file') {
			this.writeToFile();
		} else {
			this.writeToDirectory(snapshot);
		}
	}

	/**
	 * Persist all entries into a single JSON file.
	 */
	private writeToFile() {
		const orderedEntries = Object.fromEntries(Object.entries(this.entries).sort(([a], [b]) => a.localeCompare(b)));
		const file: SnapshotFile = {
			version: SNAPSHOT_VERSION,
			entries: orderedEntries,
		};
		const content = JSON.stringify(file, null, 2);
		atomicWriteFile(this.storagePath, content);
	}

	/**
	 * Persist a single snapshot into a per-key JSON file.
	 */
	private writeToDirectory(entry: SnapshotEntry) {
		const digest = createHash('sha256').update(entry.key).digest('hex');
		const filePath = join(this.storagePath, `${digest}.json`);
		const wrapper = {
			version: SNAPSHOT_VERSION,
			entry,
		};
		atomicWriteFile(filePath, JSON.stringify(wrapper, null, 2));
		this.directoryIndex[entry.key] = filePath;
	}

	/**
	 * Convert legacy flat snapshots into v2 layout.
	 */
	static migrateLegacySnapshots(
		legacy: LegacySnapshotFile,
		options: { method?: string; normalization?: string },
	): SnapshotFile {
		const entries: Record<string, SnapshotEntry> = {};
		for (const [url, value] of Object.entries(legacy)) {
			entries[`${options.method ?? 'GET'} ${url}`] = {
				key: `${options.method ?? 'GET'} ${url}`,
				request: {
					url,
					normalizedUrl: options.normalization ?? url,
					method: options.method ?? 'GET',
				},
				response: {
					status: value.status,
					headers: value.headers,
					body: value.body,
				},
				meta: {
					recordedAt: new Date().toISOString(),
					keyStrategy: 'legacy-url',
					normalization: {},
				},
			};
		}
		return { version: SNAPSHOT_VERSION, entries };
	}
}

export const isSnapshotFile = (value: unknown): value is SnapshotFile => {
	return Boolean(value && typeof value === 'object' && 'entries' in (value as Record<string, unknown>));
};

const isSnapshotEntryWrapper = (value: unknown): value is { version: number; entry: SnapshotEntry } => {
	return Boolean(value && typeof value === 'object' && 'entry' in (value as Record<string, unknown>));
};
