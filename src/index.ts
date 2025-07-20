import type { Page } from '@playwright/test';
import { SnapshotsStore } from './store';
import type { PluginConfig } from './types';
import { ensureError } from './utils';

const DEFAULT_CONFIG: PluginConfig = {
	urlMatch: '**/*',
	apiSnapshotsPath: 'api_snapshots.json',
	logLevel: 'info',
	mock: true,
};

class Plugin {
	private page: Page;
	private store: SnapshotsStore;
	private config: PluginConfig;

	constructor(page: Page, config?: Partial<PluginConfig>) {
		this.page = page;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.store = new SnapshotsStore(this.config);
	}

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

	async record(configOverwrite?: Partial<PluginConfig>): Promise<void> {
		if (configOverwrite) {
			const customPlugin = new Plugin(this.page, { ...this.config, ...configOverwrite });
			return await customPlugin.record();
		}

		await this.page.route(this.config.urlMatch, async (route) => {
			const request = route.request();
			const url = request.url();

			const storedSnapshot = this.config.mock ? this.store.getStoredSnapshot(url) : undefined;
			if (storedSnapshot) {
				this.log(`[Mocked] ${url}`);
				return await route.fulfill({
					// Content-type?
					status: storedSnapshot.status,
					headers: storedSnapshot.headers,
					body: JSON.stringify(storedSnapshot.body),
				});
			}

			// Fetch real response and store it
			try {
				const response = await route.fetch();
				await this.store.storeResponse(url, response);
				this.log(`[Recorded] ${url}`);
			} catch (e) {
				this.log(ensureError(e));
			} finally {
				await route.continue();
			}
		});
	}
}

export const ApiMockPlugin = Plugin;
