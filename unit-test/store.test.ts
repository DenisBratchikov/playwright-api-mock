import { SnapshotsStore } from '../src/store';
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'store-'));
}

test('stores responses on disk', async () => {
  const dir = createTempDir();
  const file = join(dir, 'snap.json');
  const store = new SnapshotsStore({ apiSnapshotsPath: file });

  const response = {
    async json() { return { ok: true }; },
    status() { return 201; },
    headers() { return { 'content-type': 'application/json' }; },
  } as any;

  await store.storeResponse('key', response);
  const saved = JSON.parse(readFileSync(file, 'utf-8'));
  expect(saved.key.status).toBe(201);
  expect(saved.key.body.ok).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test('applies header filter', async () => {
  const dir = createTempDir();
  const file = join(dir, 'snap.json');
  const store = new SnapshotsStore({
    apiSnapshotsPath: file,
    getStoredHeaders: (h) => ({ 'content-type': h['content-type'] }),
  });

  const response = {
    async json() { return { a: 1 }; },
    status() { return 200; },
    headers() { return { 'content-type': 'application/json', other: 'x' }; },
  } as any;

  await store.storeResponse('url', response);
  const snap = store.getStoredSnapshot('url');
  expect(snap?.headers).toStrictEqual({ 'content-type': 'application/json' });
  rmSync(dir, { recursive: true, force: true });
});
