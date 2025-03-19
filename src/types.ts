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
}
