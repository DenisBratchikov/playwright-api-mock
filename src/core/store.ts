import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import type { APIResponse } from "@playwright/test";
import type {
  SnapshotEntry,
  SnapshotFile,
  StoreConfig,
  GroupingStrategy,
} from "./types";
import { atomicWriteFile, resolveGroupKey } from "./utils";

const SNAPSHOT_VERSION = 2;
const INDEX_VERSION = 1;

interface ChunkInfo {
  file: string;
  count: number;
}

interface MasterIndex {
  version: number;
  chunks: Record<string, ChunkInfo>;
  total: number;
  grouping?: string; // Store grouping strategy identifier
}

interface ChunkIndex {
  version: number;
  keys: Record<string, string>; // key -> filename
}

const ensureDir = (path: string) => {
  fs.mkdirSync(path, { recursive: true });
};

const readJson = (path: string): unknown =>
  JSON.parse(fs.readFileSync(path, "utf-8"));

/**
 * Snapshot storage supporting single-file, directory, and chunked index layouts.
 */
export class SnapshotsStore {
  private storagePath: string;
  private storageType: StoreConfig["storage"]["type"];
  private grouping: GroupingStrategy | undefined;
  private getStoredHeaders: StoreConfig["getStoredHeaders"];

  // Legacy support
  private entries: Record<string, SnapshotEntry> = {};
  private directoryIndex: Record<string, string> = {};

  // Chunked index support
  private masterIndex: Map<string, ChunkInfo> = new Map();
  private chunkIndexes: Map<string, Map<string, string>> = new Map(); // group -> (key -> filename)
  private loadedChunks: Set<string> = new Set();
  private useChunkedIndex = false;

  constructor(params: StoreConfig) {
    const storage = params.storage ?? {
      type: "file" as const,
      path: "api_snapshots.json",
    };
    this.storagePath = storage.path;
    this.storageType = storage.type;
    this.grouping = storage.grouping;
    this.getStoredHeaders = params.getStoredHeaders;

    // Use chunked index if directory mode with grouping
    this.useChunkedIndex =
      this.storageType === "dir" && this.grouping !== undefined;

    if (this.useChunkedIndex) {
      this.loadMasterIndex();
    } else if (this.storageType === "file") {
      // Legacy file mode
      if (fs.existsSync(this.storagePath)) {
        const parsed = readJson(this.storagePath);
        if (isSnapshotFile(parsed)) {
          this.entries = parsed.entries ?? {};
        }
      } else {
        fs.mkdirSync(dirname(this.storagePath), { recursive: true });
        this.entries = {};
      }
    } else {
      // Legacy directory mode (no grouping)
      ensureDir(this.storagePath);
      for (const file of fs.readdirSync(this.storagePath)) {
        if (!file.endsWith(".json")) continue;
        const full = join(this.storagePath, file);
        const parsed = readJson(full);
        if (isSnapshotFile(parsed)) {
          for (const [key, entry] of Object.entries(parsed.entries)) {
            this.entries[key] = entry;
            this.directoryIndex[key] = full;
          }
        } else if (isSnapshotEntryWrapper(parsed)) {
          this.entries[parsed.entry.key] = parsed.entry;
          this.directoryIndex[parsed.entry.key] = full;
        }
      }
    }
  }

  /**
   * Load master index - fast, small file, always loaded
   */
  private loadMasterIndex() {
    const indexPath = join(this.storagePath, "index.json");
    if (fs.existsSync(indexPath)) {
      try {
        const data = readJson(indexPath) as MasterIndex;
        if (data.chunks) {
          for (const [groupKey, info] of Object.entries(data.chunks)) {
            this.masterIndex.set(groupKey, info);
          }
        }
      } catch (e) {
        // Invalid index, will rebuild
      }
    }
  }

  /**
   * Load a chunk index lazily (only when needed)
   */
  private loadChunkIndex(groupKey: string): Map<string, string> {
    // Return if already loaded
    const cached = this.chunkIndexes.get(groupKey);
    if (cached) {
      return cached;
    }

    // Load from disk
    const chunkInfo = this.masterIndex.get(groupKey);
    const chunkPath = chunkInfo
      ? join(this.storagePath, chunkInfo.file)
      : join(this.storagePath, "chunks", `${groupKey}.json`);

    if (fs.existsSync(chunkPath)) {
      try {
        const data = readJson(chunkPath) as ChunkIndex;
        const index = new Map(Object.entries(data.keys || {}));
        this.chunkIndexes.set(groupKey, index);
        this.loadedChunks.add(groupKey);
        return index;
      } catch (e) {
        // Invalid chunk, return empty
      }
    }

    return new Map();
  }

  /**
   * Retrieve a snapshot by key.
   */
  async getStoredSnapshot(
    key: string,
    url?: string
  ): Promise<SnapshotEntry | undefined> {
    // Fast path: already loaded in memory
    if (this.entries[key]) {
      return this.entries[key];
    }

    if (this.useChunkedIndex) {
      // Use chunked index lookup
      const groupKey = await resolveGroupKey(this.grouping, key, url || key);
      const chunkIndex = this.loadChunkIndex(groupKey);
      const filename = chunkIndex.get(key);

      if (filename) {
        const snapshotPath = join(this.storagePath, "data", filename);
        if (fs.existsSync(snapshotPath)) {
          try {
            const data = readJson(snapshotPath);
            const entry = isSnapshotEntryWrapper(data) ? data.entry : undefined;
            if (entry) {
              this.entries[key] = entry; // Cache it
              return entry;
            }
          } catch (e) {
            // Invalid file
          }
        }
      }
      return undefined;
    }

    // Legacy directory mode lookup
    const filePath = this.directoryIndex[key];
    if (filePath && fs.existsSync(filePath)) {
      try {
        const data = readJson(filePath);
        if (isSnapshotEntryWrapper(data)) {
          const entry = data.entry;
          this.entries[key] = entry;
          return entry;
        }
      } catch (e) {
        // Invalid file
      }
    }

    return undefined;
  }

  /**
   * Enumerate stored snapshot entries.
   */
  listEntries(): SnapshotEntry[] {
    if (this.useChunkedIndex) {
      // Load all chunks and collect entries
      const allEntries: SnapshotEntry[] = [];
      for (const [groupKey] of this.masterIndex) {
        const chunkIndex = this.loadChunkIndex(groupKey);
        for (const [key, filename] of chunkIndex) {
          const entry =
            this.entries[key] || this.loadEntryFromFile(key, filename);
          if (entry) {
            allEntries.push(entry);
          }
        }
      }
      return allEntries;
    }
    return Object.values(this.entries);
  }

  private loadEntryFromFile(
    key: string,
    filename: string
  ): SnapshotEntry | undefined {
    const snapshotPath = join(this.storagePath, "data", filename);
    if (fs.existsSync(snapshotPath)) {
      try {
        const data = readJson(snapshotPath);
        const entry = isSnapshotEntryWrapper(data) ? data.entry : undefined;
        if (entry) {
          this.entries[key] = entry;
          return entry;
        }
      } catch (e) {
        // Invalid file
      }
    }
    return undefined;
  }

  /**
   * Store a response in the snapshot store (record mode).
   */
  async storeResponse(
    key: string,
    response: APIResponse,
    entry: Omit<SnapshotEntry, "response">
  ) {
    const headers = this.getStoredHeaders?.(response.headers());
    const contentType = response.headers()["content-type"] ?? "";
    let body: unknown;
    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    const snapshot: SnapshotEntry = {
      ...entry,
      response: {
        status: response.status(),
        headers,
        body,
      },
    };

    this.entries[key] = snapshot;
    if (this.storageType === "file") {
      this.writeToFile();
    } else {
      this.writeToDirectory(snapshot);
    }
  }

  /**
   * Save a prepared snapshot entry.
   */
  async saveEntry(snapshot: SnapshotEntry) {
    this.entries[snapshot.key] = snapshot;

    if (this.useChunkedIndex) {
      await this.saveEntryChunked(snapshot);
    } else if (this.storageType === "file") {
      this.writeToFile();
    } else {
      this.writeToDirectory(snapshot);
    }
  }

  /**
   * Save entry using chunked index structure.
   */
  private async saveEntryChunked(snapshot: SnapshotEntry) {
    const url = snapshot.request.url;
    const groupKey = await resolveGroupKey(this.grouping, snapshot.key, url);

    // Ensure data directory exists
    const dataDir = join(this.storagePath, "data");
    ensureDir(dataDir);

    // Save snapshot file
    const filename = `${createHash("sha256")
      .update(snapshot.key)
      .digest("hex")}.json`;
    const snapshotPath = join(dataDir, filename);
    atomicWriteFile(
      snapshotPath,
      JSON.stringify({ version: SNAPSHOT_VERSION, entry: snapshot }, null, 2)
    );

    // Update chunk index
    const chunkIndex = this.loadChunkIndex(groupKey);
    chunkIndex.set(snapshot.key, filename);

    // Write chunk index
    const chunksDir = join(this.storagePath, "chunks");
    ensureDir(chunksDir);
    const chunkPath = join(chunksDir, `${groupKey}.json`);
    atomicWriteFile(
      chunkPath,
      JSON.stringify(
        {
          version: INDEX_VERSION,
          keys: Object.fromEntries(chunkIndex),
        },
        null,
        2
      )
    );

    // Update master index
    const chunkInfo: ChunkInfo = {
      file: `chunks/${groupKey}.json`,
      count: chunkIndex.size,
    };
    this.masterIndex.set(groupKey, chunkInfo);

    // Write master index (can batch/debounce this)
    this.writeMasterIndex();
  }

  /**
   * Write master index file.
   */
  private writeMasterIndex() {
    const indexPath = join(this.storagePath, "index.json");
    const total = Array.from(this.masterIndex.values()).reduce(
      (sum, info) => sum + info.count,
      0
    );
    const data: MasterIndex = {
      version: INDEX_VERSION,
      chunks: Object.fromEntries(this.masterIndex),
      total,
    };
    atomicWriteFile(indexPath, JSON.stringify(data, null, 2));
  }

  /**
   * Persist all entries into a single JSON file.
   */
  private writeToFile() {
    const orderedEntries = Object.fromEntries(
      Object.entries(this.entries).sort(([a], [b]) => a.localeCompare(b))
    );
    const file: SnapshotFile = {
      version: SNAPSHOT_VERSION,
      entries: orderedEntries,
    };
    const content = JSON.stringify(file, null, 2);
    atomicWriteFile(this.storagePath, content);
  }

  /**
   * Persist a single snapshot into a per-key JSON file.
   */
  private writeToDirectory(entry: SnapshotEntry) {
    const digest = createHash("sha256").update(entry.key).digest("hex");
    const filePath = join(this.storagePath, `${digest}.json`);
    const wrapper = {
      version: SNAPSHOT_VERSION,
      entry,
    };
    atomicWriteFile(filePath, JSON.stringify(wrapper, null, 2));
    this.directoryIndex[entry.key] = filePath;
  }
}

export const isSnapshotFile = (value: unknown): value is SnapshotFile => {
  return Boolean(
    value &&
      typeof value === "object" &&
      "entries" in (value as Record<string, unknown>)
  );
};

const isSnapshotEntryWrapper = (
  value: unknown
): value is { version: number; entry: SnapshotEntry } => {
  return Boolean(
    value &&
      typeof value === "object" &&
      "entry" in (value as Record<string, unknown>)
  );
};
