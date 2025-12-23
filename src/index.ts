/**
 * Public entry point exporting the Playwright API mock plugin and helpers.
 */
export { ApiMockPlugin } from './core/plugin.js';
export { SnapshotsStore } from './core/store.js';
export {
	normalizeUrlDefault,
	buildDefaultKey,
	variantToString,
	hashObject,
	stableStringify,
	ensureError,
} from './core/utils.js';
export { migrateSnapshots, validateSnapshots, snapshotStats } from './maintenance/index.js';
export type * from './core/types.js';
