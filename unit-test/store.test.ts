import { SnapshotsStore } from "../src/core/store";
import { test, expect } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "store-"));
}

test("stores snapshots in a single file with metadata", () => {
  const dir = createTempDir();
  const file = join(dir, "snap.json");
  const store = new SnapshotsStore({ storage: { type: "file", path: file } });

  store.saveEntry({
    key: "GET http://example.com/users",
    request: {
      url: "http://example.com/users",
      normalizedUrl: "http://example.com/users",
      method: "GET",
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    },
    meta: {
      recordedAt: "now",
      keyStrategy: "method-url",
      normalization: {},
    },
  });

  const saved = JSON.parse(readFileSync(file, "utf-8"));
  expect(saved.version).toBe(2);
  expect(saved.entries["GET http://example.com/users"].response.body.ok).toBe(
    true
  );
  rmSync(dir, { recursive: true, force: true });
});

test("stores snapshots in directory mode", () => {
  const dir = createTempDir();
  const store = new SnapshotsStore({ storage: { type: "dir", path: dir } });

  store.saveEntry({
    key: "key-1",
    request: { url: "u", normalizedUrl: "u", method: "GET" },
    response: { status: 200, body: "text" },
    meta: { recordedAt: "now", keyStrategy: "method-url", normalization: {} },
  });

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);
  rmSync(dir, { recursive: true, force: true });
});
