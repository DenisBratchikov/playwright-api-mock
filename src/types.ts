type StoresHeaders = { [key: string]: string };
type LogLevel = 'silent' | 'error' | 'info';

export interface StoredSnapshots {
	[key: string]: {
		status: number;
		headers?: StoresHeaders;
		body: unknown;
	};
}

export interface StoreConfig {
	apiSnapshotsPath: string;
	getStoredHeaders?: (headers: StoresHeaders) => StoresHeaders | undefined;
}

export interface PluginConfig extends StoreConfig {
	urlMatch: string | RegExp;
	logLevel: LogLevel;
	/**
	 * When true, stored snapshots will be used to fulfill requests.
	 * When false, responses will always be fetched from the server
	 * and stored for future use.
	 */
	mock: boolean;
}
