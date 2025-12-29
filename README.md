# Playwright API Mock

> A reliable “record & replay” API snapshot mocking tool for Playwright with stable keys, variants/personas, and a clean record/mock workflow.

## 🚀 What’s new

- **Stable snapshot keys**: method + normalized URL with deterministic query ordering, optional param filters, path rewriting (e.g., IDs → `:id`), and optional body hashes.
- **Variants/personas**: add a variant dimension to keys (`variant: string | object | () => ...`) plus per-request `resolveVariant` hooks.
- **Record/mock workflow**: explicit `mode: 'record' | 'mock' | 'auto'`, configurable behavior for missing snapshots/mismatches, and atomic writes for deterministic snapshots.
- **Flexible hooks & per-route rules**: override keys, variants, normalization, and response transforms without hardcoding business logic.
- **Storage options**: file or directory-backed stores with metadata (recordedAt, key strategy, normalization rules, variant used) and legacy migration utilities/CLI.

## 📦 Installation

```shell
npm add -D playwright-api-mock
```

## 🛠️ Quickstart (fixture-based)

```typescript
// test/fixtures.ts
import { test as base } from "@playwright/test";
import { ApiMockPlugin } from "playwright-api-mock";

export const test = base.extend<{ apiMock: ApiMockPlugin }>({
  apiMock: async ({ page }, use) => {
    const apiMock = new ApiMockPlugin(page, {
      urlMatch: "**/api/**",
      storage: { type: "dir", path: "__snapshots__/api" },
      mode: "auto", // use snapshot if available, otherwise record
      logLevel: "info",
      variant: () => process.env.USER_TIER ?? "Free",
      resolveVariant: (req) =>
        req.url().includes("users/me")
          ? process.env.USER_TIER ?? "Free"
          : undefined,
      urlNormalization: {
        stripQuery: true, // normalize away volatile query params
        pathRewriters: [{ pattern: /\d+/, replace: ":id" }],
      },
    });
    await use(apiMock);
  },
});
```

Use it in Playwright tests:

```typescript
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("records then replays snapshots", async ({ page, apiMock }) => {
  await apiMock.record(); // sets up routing
  await page.goto("/dashboard");
  await expect(page.getByText("Welcome")).toBeVisible();
});
```

### Variant/persona example

```typescript
const apiMock = new ApiMockPlugin(page, {
  storage: { type: "dir", path: "__snapshots__/api" },
  variant: () => process.env.USER_TIER, // Expert/Pro/Free from env
  resolveVariant: (req) =>
    req.url().includes("users/me") ? process.env.USER_TIER : undefined,
  mode: "auto",
});
```

Snapshots are keyed by `METHOD normalized-url | variant=<value>`, so Expert/Pro/Free can coexist for the same endpoint.

## ⚙️ Core configuration

| Option                                  | Type                                      | Default                                                | Notes                                                                                                                            |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `urlMatch`                              | `string \| RegExp`                        | `**/*`                                                 | Route matcher for Playwright                                                                                                     |
| `mode`                                  | `'record' \| 'mock' \| 'auto'`            | `auto`                                                 | `record`: always hit BE + store; `mock`: serve only snapshots (fail on missing by default); `auto`: replay if exists else record |
| `onMissingSnapshot`                     | `'fail' \| 'passthrough' \| 'record'`     | depends on mode                                        | Controls what happens when a snapshot is missing                                                                                 |
| `onMismatch`                            | `'fail' \| 'warn'`                        | `warn`                                                 | Triggered when a nearby snapshot exists but the key differs                                                                      |
| `storage`                               | `{ type: 'file' \| 'dir'; path: string }` | `file @ api_snapshots.json`                            | `dir` reduces merge conflicts                                                                                                    |
| `urlNormalization`                      | `UrlNormalizationRules`                   | `{ orderQueryParams: true }`                           | Strip/allow/deny query params, order deterministically, path rewrites                                                            |
| `keyStrategy`                           | `KeyStrategy`                             | method + normalized URL + body hash for POST/PUT/PATCH | Include request body hash (stable JSON) or provide custom hasher/extractor                                                       |
| `variant`                               | `string \| object \| () => ...`           | `undefined`                                            | Optional dimension added to the snapshot key                                                                                     |
| `resolveVariant`                        | `(req, ctx) => ...`                       | `undefined`                                            | Per-request variant override                                                                                                     |
| `shouldHandleRequest`                   | `(req) => boolean`                        | `true`                                                 | Filter domains/resource types                                                                                                    |
| `normalizeUrl`                          | `(url, ctx) => string`                    | `normalizeUrlDefault`                                  | Override URL normalization                                                                                                       |
| `normalizeHeaders` / `getStoredHeaders` | `(headers) => headers`                    | `undefined`                                            | Capture/strip response headers before storing                                                                                    |
| `extractBody`                           | `(req) => unknown`                        | best-effort JSON/text                                  | Used for body hashing                                                                                                            |
| `keyFn`                                 | `(input) => string`                       | default key builder                                    | Override snapshot key generation                                                                                                 |
| `rules`                                 | `RuleConfig[]`                            | `[]`                                                   | Per-route overrides: custom key/variant/normalization and response transforms                                                    |

### RuleConfig highlights

- `match`: `RegExp | string | (req) => boolean`
- `key` / `keyFn`: override snapshot key
- `variant` / `resolveVariant`: override persona per request
- `normalizeUrl`: per-rule URL normalization
- `onRecordResponse` / `onServeResponse`: mutate response bodies (e.g., drop timestamps, strip PII)

## 🔑 Snapshot keys & normalization

- **Default key**: `METHOD normalized-url` + `variant=<value>` + `body=<hash>` (when configured).
- **Normalization options**:
  - `stripQuery`: drop query params entirely
  - `includeQueryParams` / `excludeQueryParams`: allow/deny lists
  - `orderQueryParams`: deterministic ordering (default `true`)
  - `pathRewriters`: rewrite path segments (e.g., `/users/123` → `/users/:id`)
- **Body hashing**: enabled for `POST/PUT/PATCH` by default; customize via `keyStrategy.bodyHashFn` or `bodyFieldExtractor`.
- Public helpers: `normalizeUrlDefault`, `buildDefaultKey`, `hashObject`, `variantToString` (exported).

## 🗂️ Storage

- **File mode**: single JSON with metadata `{ version: 2, entries: { key: SnapshotEntry } }`.
- **Directory mode**: one JSON per snapshot key (better for PR conflicts).
- Each entry stores `recordedAt`, `keyStrategy`, `normalization` rules used, and the variant applied.

## 🧭 Workflow: record vs mock

- `mode: 'record'`: always hits the backend and stores snapshots.
- `mode: 'mock'`: serves snapshots only; missing snapshots throw by default (`onMissingSnapshot: 'fail'`).
- `mode: 'auto'`: replay if present; otherwise record and return the live response.
- Deterministic writes: JSON ordering and atomic temp-file renames reduce flakiness.

## 🧩 Hooks & per-route rules

- `shouldHandleRequest(req)`: skip certain domains/resource types.
- `normalizeUrl(url, ctx)`, `normalizeHeaders(headers)`, `extractBody(req)` for custom capture logic.
- Register `rules` to override keys/variants or strip volatile response fields per endpoint.

## 🛠️ CLI utilities

The package ships with a small CLI:

```
pwamock validate __snapshots__/api       # detect duplicate/missing keys
pwamock stats __snapshots__/api          # counts by endpoint/variant
```

## 🧪 Demo: variants for Expert/Pro/Free

See [`test/demo`](test/demo/demo.spec.ts) for a Playwright example that records and replays different variants of `users/me` and `subscription/plan` using the `variant` + `resolveVariant` hooks. Run it locally:

```bash
bun run demo:start      # start the demo server
bun run demo:test       # build + run Playwright demo tests
```

## 🔒 Data hygiene

- Avoid storing secrets/PII. Use `normalizeHeaders`, `onRecordResponse`, or `rules` to strip tokens, timestamps, or user-specific identifiers before writing snapshots.

## 📖 API

### `record(config?: Partial<PluginConfig>): Promise<void>`

Registers the request handler with the current configuration (merged with any overrides) and applies the selected `mode`.

### Exports

- `ApiMockPlugin`, `SnapshotsStore`
- Helpers: `normalizeUrlDefault`, `buildDefaultKey`, `variantToString`, `hashObject`, `stableStringify`
- Maintenance utilities: `validateSnapshots`, `snapshotStats`

## 🤝 How to Contribute

1. Fork and clone this repository.
2. Install dependencies with `bun install`.
3. Run checks:
   ```bash
   bun run lint
   bun run test
   bun run build
   ```
4. Explore the demo under [`test/demo/`](test/demo/):
   ```bash
   bun run demo:start # optional: run the backend server
   bun run demo:test
   ```
5. Open a pull request with your changes.

## 📜 License

MIT License. See LICENSE for details.
