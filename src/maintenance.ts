import * as fs from 'node:fs';
import { SnapshotsStore, isSnapshotFile } from './store';
import type { LegacySnapshotFile, SnapshotEntry, SnapshotFile } from './types';
import { atomicWriteFile } from './utils';

export interface ValidationResult {
	issues: string[];
}

export const migrateSnapshots = (path: string, targetPath?: string): SnapshotFile | undefined => {
	if (!fs.existsSync(path)) return undefined;
	const raw = JSON.parse(fs.readFileSync(path, 'utf-8')) as unknown;
	if (isSnapshotFile(raw)) {
		return raw;
	}

	const migrated = SnapshotsStore.migrateLegacySnapshots(raw as LegacySnapshotFile, { method: 'GET' });
	const destination = targetPath ?? path;
	atomicWriteFile(destination, JSON.stringify(migrated, null, 2));
	return migrated;
};

export const validateSnapshots = (entries: SnapshotEntry[]): ValidationResult => {
	const seenKeys = new Set<string>();
	const issues: string[] = [];
	for (const entry of entries) {
		if (seenKeys.has(entry.key)) {
			issues.push(`Duplicate key: ${entry.key}`);
		}
		seenKeys.add(entry.key);
		if (!entry.request.normalizedUrl) {
			issues.push(`Missing normalizedUrl for key ${entry.key}`);
		}
		if (!entry.request.method) {
			issues.push(`Missing method for key ${entry.key}`);
		}
	}
	return { issues };
};

export const snapshotStats = (entries: SnapshotEntry[]) => {
	const byEndpoint: Record<string, number> = {};
	const byVariant: Record<string, number> = {};

	for (const entry of entries) {
		byEndpoint[entry.request.normalizedUrl] = (byEndpoint[entry.request.normalizedUrl] ?? 0) + 1;
		const variantKey = entry.request.variant ?? 'default';
		byVariant[variantKey] = (byVariant[variantKey] ?? 0) + 1;
	}

	return {
		total: entries.length,
		byEndpoint,
		byVariant,
	};
};
