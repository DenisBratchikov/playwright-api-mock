import * as fs from 'node:fs';
import { dirname } from 'node:path';
import type { APIResponse } from '@playwright/test';
import type { StoreConfig, StoredSnapshots } from './types';

export class SnapshotsStore {
	private path: string;
	private getStoredHeaders: StoreConfig['getStoredHeaders'];
	private snapshots: StoredSnapshots;

	constructor(params: StoreConfig) {
		this.path = params.apiSnapshotsPath;
		this.getStoredHeaders = params.getStoredHeaders;

		if (fs.existsSync(this.path)) {
			this.snapshots = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
		} else {
			fs.mkdirSync(dirname(this.path), { recursive: true });
			this.snapshots = {};
		}
	}

	getStoredSnapshot(key: string) {
		return this.snapshots[key];
	}

	async storeResponse(key: string, response: APIResponse) {
		const body = await response.json();

		this.snapshots[key] = {
			status: response.status(),
			headers: this.getStoredHeaders?.(response.headers()),
			body,
		};

		fs.mkdirSync(dirname(this.path), { recursive: true });
		fs.writeFileSync(this.path, JSON.stringify(this.snapshots, null, 2));
	}
}
