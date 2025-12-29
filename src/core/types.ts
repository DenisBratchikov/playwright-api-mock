import type { Page, Request, Route } from "@playwright/test";

/**
 * Allowed response headers to persist in snapshots.
 */
export type StoresHeaders = Record<string, string>;

/**
 * Log verbosity levels supported by the plugin.
 */
export type LogLevel = "silent" | "error" | "info";

/**
 * Optional variant/persona dimension attached to snapshots.
 */
export type Variant = string | number | boolean | Record<string, unknown>;

/**
 * Function-based variant resolver signature (request/context parameters optional for flexibility).
 */
export type VariantFunction = (
  req?: Request,
  context?: HookContext
) => Variant | undefined | Promise<Variant | undefined>;

export type Mode = "record" | "mock" | "auto";
export type OnMissingSnapshot = "fail" | "passthrough" | "record";
export type OnMismatch = "fail" | "warn";

/**
 * Rules for URL normalization before generating snapshot keys.
 */
export interface UrlNormalizationRules {
  /**
   * Drop all query parameters before matching.
   */
  stripQuery?: boolean;
  /**
   * Only keep these query parameters (allow-list). Mutually exclusive with excludeQueryParams.
   */
  includeQueryParams?: string[];
  /**
   * Remove these query parameters (deny-list).
   */
  excludeQueryParams?: string[];
  /**
   * Ensure query params are sorted deterministically (default: true).
   */
  orderQueryParams?: boolean;
  /**
   * Path rewrite rules applied in order. Useful to replace volatile segments like numeric IDs.
   */
  pathRewriters?: Array<{ pattern: RegExp; replace: string }>;
}

/**
 * Strategy for generating snapshot keys.
 */
export interface KeyStrategy {
  name?: string;
  /**
   * Methods that should include request body hash in the key. Defaults to POST, PUT, PATCH.
   */
  includeBodyForMethods?: string[];
  /**
   * When true, include body hash for all methods.
   */
  includeBody?: boolean;
  /**
   * Custom body hashing logic. Receives the extracted body.
   */
  bodyHashFn?: (body: unknown) => string;
  /**
   * Optional extractor to pick fields from the request body before hashing.
   */
  bodyFieldExtractor?: (body: unknown) => unknown;
}

/**
 * Per-route override configuration.
 */
export interface RuleConfig {
  match: RegExp | string | ((req: Request) => boolean | Promise<boolean>);
  key?: string | ((input: SnapshotKeyInput) => string | Promise<string>);
  variant?: Variant | VariantFunction;
  resolveVariant?: (
    req: Request,
    context: HookContext
  ) => Variant | undefined | Promise<Variant | undefined>;
  normalizeUrl?: (
    url: string,
    context: HookContext
  ) => string | Promise<string>;
  onRecordResponse?: (
    body: unknown,
    context: HookContext
  ) => unknown | Promise<unknown>;
  onServeResponse?: (
    body: unknown,
    context: HookContext
  ) => unknown | Promise<unknown>;
  keyFn?: (input: SnapshotKeyInput) => string | Promise<string>;
}

/**
 * Grouping strategy for organizing snapshots into chunks/files.
 * - "chunks": Hash-based chunking (256 chunks, evenly distributed)
 * - RegExp: Match URL against regex, use match result as group key
 * - string: Pattern with wildcards (*), use matched pattern as group key
 * - function: Custom grouping function (key, url) => groupKey
 */
export type GroupingStrategy =
  | "chunks" // Hash-based chunking (default, internal logic)
  | RegExp // Regex pattern matching
  | string // String pattern with wildcards (e.g., "v2/user/*", "*/user/*")
  | ((key: string, url: string) => string | Promise<string>); // Custom function

/**
 * Snapshot storage configuration.
 */
export interface StorageConfig {
  type: "file" | "dir";
  path: string;
  /**
   * Grouping strategy for organizing snapshots.
   * Only applies to directory mode. When set, enables chunked index structure.
   *
   * @example
   * // Hash-based (default)
   * grouping: "chunks"
   *
   * @example
   * // By API version
   * grouping: /\/v(\d+)\//
   *
   * @example
   * // By path pattern
   * grouping: "v2/user/*"
   *
   * @example
   * // Custom function
   * grouping: (key, url) => {
   *   const match = url.match(/\/api\/([^/]+)/);
   *   return match ? match[1] : "other";
   * }
   */
  grouping?: GroupingStrategy;
}

export interface StoreConfig {
  storage: StorageConfig;
  getStoredHeaders?: (headers: StoresHeaders) => StoresHeaders | undefined;
}

/**
 * Primary plugin configuration.
 */
export interface PluginConfig extends StoreConfig {
  urlMatch: string | RegExp;
  logLevel: LogLevel;
  mode: Mode;
  onMissingSnapshot?: OnMissingSnapshot;
  onMismatch?: OnMismatch;
  shouldHandleRequest?: (req: Request) => boolean | Promise<boolean>;
  normalizeUrl?: (
    url: string,
    context: HookContext
  ) => string | Promise<string>;
  normalizeHeaders?: (headers: StoresHeaders) => StoresHeaders | undefined;
  extractBody?: (req: Request) => Promise<unknown> | unknown;
  keyFn?: (input: SnapshotKeyInput) => string | Promise<string>;
  keyStrategy?: KeyStrategy;
  variant?: Variant | VariantFunction;
  resolveVariant?: (
    req: Request,
    context: HookContext
  ) => Variant | undefined | Promise<Variant | undefined>;
  rules?: RuleConfig[];
  urlNormalization?: UrlNormalizationRules;
}

/**
 * Shared context passed into hook callbacks.
 */
export interface HookContext {
  page: Page;
  request: Request;
  route: Route;
  config: PluginConfig;
}

/**
 * Inputs to snapshot key generation.
 */
export interface SnapshotKeyInput {
  method: string;
  normalizedUrl: string;
  variant?: string;
  bodyHash?: string;
  url: string;
}

/**
 * Metadata stored alongside snapshots for debuggability.
 */
export interface SnapshotMetadata {
  recordedAt: string;
  playwrightVersion?: string;
  keyStrategy: string;
  normalization: UrlNormalizationRules;
  variant?: string;
}

export interface SnapshotEntry {
  key: string;
  request: {
    url: string;
    normalizedUrl: string;
    method: string;
    bodyHash?: string;
    variant?: string;
  };
  response: {
    status: number;
    headers?: StoresHeaders;
    body: unknown;
  };
  meta: SnapshotMetadata;
}

/**
 * Snapshot file layout (v2).
 */
export interface SnapshotFile {
  version: 2;
  entries: Record<string, SnapshotEntry>;
  metadata?: {
    keyStrategy?: string;
    normalization?: UrlNormalizationRules;
  };
}
