#!/usr/bin/env node
import * as fs from 'node:fs';
import { SnapshotsStore } from '../core/store.js';
import { migrateSnapshots, snapshotStats, validateSnapshots } from '../maintenance/index.js';

const inferStorage = (path: string) => {
	if (fs.existsSync(path) && fs.lstatSync(path).isDirectory()) {
		return { type: 'dir' as const, path };
	}
	return { type: 'file' as const, path };
};

const usage = () => {
	console.log(`Usage: pwamock <command> [path]

Commands:
  migrate [path]   Convert legacy flat snapshot file to the new format.
  validate [path]  Validate snapshot file or directory.
  stats [path]     Print basic statistics by endpoint and variant.
`);
};

const main = async () => {
	const [command, pathArg] = process.argv.slice(2);
	const path = pathArg ?? 'api_snapshots.json';

	if (!command) {
		usage();
		process.exit(1);
	}

	if (command === 'migrate') {
		const migrated = migrateSnapshots(path);
		if (!migrated) {
			console.error(`No snapshots found at ${path}`);
			process.exit(1);
		}
		console.log(`Migrated ${Object.keys(migrated.entries).length} snapshots to ${path}`);
		return;
	}

	if (command === 'validate') {
		const store = new SnapshotsStore({ storage: inferStorage(path) });
		const validation = validateSnapshots(store.listEntries());
		if (validation.issues.length === 0) {
			console.log('No validation issues found.');
		} else {
			console.error(`Found ${validation.issues.length} issues:\n- ${validation.issues.join('\n- ')}`);
			process.exitCode = 1;
		}
		return;
	}

	if (command === 'stats') {
		const store = new SnapshotsStore({ storage: inferStorage(path) });
		const stats = snapshotStats(store.listEntries());
		console.log(JSON.stringify(stats, null, 2));
		return;
	}

	usage();
	process.exit(1);
};

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
