# Performance Analysis & Optimization Guide

## 📋 Executive Summary

**Current Performance Impact** (1000 snapshots, 100 API calls per test):

- **File Mode**: ~5.5-6 seconds overhead per test
- **Directory Mode**: ~3.8-5.3 seconds overhead per test
- **Mock Mode**: ~3 seconds wasted on unnecessary searches

**Top 3 Critical Issues**:

1. **Near-match search**: O(n) on every request = 3 seconds wasted
2. **File mode writes**: Full file rewrite = 2.5 seconds per test
3. **Directory mode init**: Loads all files = 1-5 seconds startup

**Quick Wins** (can save 4-5 seconds per test):

- Index near-match lookups: **-3 seconds**
- Batch file writes: **-2 seconds**
- Lazy load snapshots: **-1-2 seconds**

---

## 🚨 Critical Performance Issues

This document highlights performance-sensitive areas that can significantly impact test execution time in projects with hundreds of tests and many daily runs.

### 1. **Synchronous File I/O in Constructor** ⚠️ CRITICAL

**Location**: `src/core/store.ts:27-63`

**Issue**: The `SnapshotsStore` constructor performs synchronous file operations that block the event loop:

- `fs.existsSync()` - synchronous file existence check
- `fs.readFileSync()` - synchronous file read
- `fs.readdirSync()` - synchronous directory listing
- `fs.mkdirSync()` - synchronous directory creation

**Impact**:

- Blocks Node.js event loop during initialization
- With hundreds of snapshots in directory mode, initialization can take seconds
- Each test worker creates a new store instance, multiplying the cost

**Example Impact**:

```
100 snapshots × 50KB each = 5MB to read synchronously
Directory scan: ~100 file system calls
Estimated time: 50-200ms per worker × N workers
```

**Recommendation**:

- Consider lazy loading: only load snapshots when first accessed
- Use async file operations with proper error handling
- Cache store instances per worker/test context
- For directory mode, implement incremental loading

---

### 2. **File Mode: Full File Rewrite on Every Save** ⚠️ CRITICAL

**Location**: `src/core/store.ts:128-138`

**Issue**: Every `saveEntry()` call:

1. Sorts ALL entries (O(n log n))
2. Stringifies entire snapshot file (O(n))
3. Writes entire file to disk (O(n))

**Impact**:

- With 1000 snapshots, each new snapshot triggers ~1-5MB write
- In record mode with many API calls, this becomes a major bottleneck
- Disk I/O contention in parallel test execution

**Example Impact**:

```
1000 snapshots × 10KB avg = 10MB file
Each save: 10MB JSON.stringify + 10MB write = ~20-50ms
100 API calls in test = 2-5 seconds just for file writes
```

**Recommendations**:

- **Batch writes**: Collect writes and flush periodically (e.g., every 100ms or N entries)
- **Debounce writes**: Only write if no new saves for X ms
- **Incremental updates**: Track dirty entries and only rewrite changed portions
- **Background writes**: Use async writes with queue
- **Consider directory mode** for large projects (already optimized)

---

### 3. **Directory Mode: Loads All Files on Init** ⚠️ HIGH

**Location**: `src/core/store.ts:46-62`

**Issue**: Constructor reads and parses ALL snapshot files in directory mode:

- Scans entire directory synchronously
- Reads every `.json` file
- Parses JSON for each file
- Loads all into memory

**Impact**:

- With 500 snapshots: 500 file reads + 500 JSON parses
- Memory usage: all snapshots loaded even if never accessed
- Startup time: 1-5 seconds for large snapshot sets

**Example Impact**:

```
500 snapshots × 20KB = 10MB memory
500 file reads = ~500-2000ms initialization
```

**Recommendations**:

- **Lazy loading**: Only load snapshots when `getStoredSnapshot()` is called
- **Index file**: Maintain a lightweight index of keys → file mappings
- **Incremental loading**: Load on-demand with caching
- **Memory limits**: Consider LRU cache for frequently accessed snapshots

---

### 4. **Synchronous Writes in Hot Path** ⚠️ HIGH

**Location**: `src/core/utils.ts:51-56`

**Issue**: `atomicWriteFile()` uses synchronous operations:

- `fs.writeFileSync()` - blocks during write
- `fs.renameSync()` - blocks during rename

**Impact**:

- Blocks event loop during every snapshot save
- In parallel test execution, creates I/O contention
- Can cause test timeouts under heavy load

**Recommendations**:

- Use `fs.promises.writeFile()` and `fs.promises.rename()` for async writes
- Implement write queue to prevent concurrent writes to same file
- Consider using worker threads for file I/O in high-concurrency scenarios

---

### 5. **Rule Matching: Evaluates All Rules** ⚠️ MEDIUM

**Location**: `src/core/plugin.ts:223-230`

**Issue**: `findRule()` uses `Promise.all()` to evaluate ALL rules even if first one matches:

- All rule matchers execute in parallel
- No short-circuit optimization
- With many rules, unnecessary work

**Impact**:

- 50 rules = 50 async function calls even if rule #1 matches
- Each rule may do regex/string matching
- Adds 1-10ms per request

**Recommendation**:

- Use sequential evaluation with early return
- Cache compiled regex patterns
- Consider rule ordering optimization (most common first)

---

### 6. **Body Cloning: Full JSON Stringify/Parse** ⚠️ MEDIUM

**Location**: `src/core/plugin.ts:43-47`

**Issue**: `cloneBody()` does full JSON stringify then parse:

- Expensive for large response bodies
- Called for every `onServeResponse` transform
- Unnecessary if body isn't mutated

**Impact**:

- 1MB response body = ~10-50ms per clone
- If transform doesn't mutate, clone is wasted

**Recommendations**:

- Use structured clone if available (faster for large objects)
- Only clone if transform hook is present
- Consider shallow clone for simple cases
- Cache cloned bodies if same snapshot served multiple times

---

### 7. **No URL Normalization Caching** ⚠️ MEDIUM

**Location**: `src/core/plugin.ts:265-270`

**Issue**: Same URLs are normalized repeatedly:

- Normalization involves URL parsing, query sorting, regex matching
- Same URL in different requests re-normalizes
- Path rewriters run on every request

**Impact**:

- URL parsing: ~0.1-1ms per request
- Query sorting: ~0.1-0.5ms per request
- With 1000 requests to same endpoint = 100-500ms wasted

**Recommendation**:

- Cache normalized URLs: `Map<originalUrl, normalizedUrl>`
- Clear cache on config changes
- Consider LRU cache for memory efficiency

---

### 8. **Near Match Search: O(n) on Every Request** ⚠️ HIGH

**Location**: `src/core/plugin.ts:333-345`

**Issue**: `listEntries()` called on every request to find near matches:

- Creates new array from all entries: `Object.values(this.entries)`
- Linear search through all snapshots
- Happens even when snapshot exists (unnecessary)

**Impact**:

- 1000 snapshots = 1000 iterations per request
- Called on EVERY request, even successful matches
- With 100 API calls = 100,000 iterations

**Example Impact**:

```
1000 snapshots × 100 requests = 100,000 iterations
~10-50ms per request just for near-match search
Total: 1-5 seconds wasted per test
```

**Recommendation**:

- Only search if snapshot is missing
- Build index: `Map<normalizedUrl, Set<keys>>` for O(1) lookup
- Cache search results
- Make search optional/configurable

---

### 9. **Hash Computation on Every Request** ⚠️ LOW-MEDIUM

**Location**: `src/core/plugin.ts:288-292`

**Issue**: Body hash computed even if:

- Same body was hashed before
- Body hasn't changed
- Hash result could be cached

**Impact**:

- SHA256 hash: ~0.5-2ms for typical bodies
- `stableStringify()`: ~1-5ms for complex objects
- Repeated requests with same body waste computation

**Recommendation**:

- Cache hash results: `Map<bodyString, hash>`
- Use WeakMap for object-based caching
- Consider faster hash algorithms for non-cryptographic use

---

## 📊 Performance Benchmarks (Estimated)

### Current Performance (1000 snapshots, 100 API calls per test)

| Operation                        | Time       | Notes                |
| -------------------------------- | ---------- | -------------------- |
| Store initialization (file mode) | 50-200ms   | Reads entire file    |
| Store initialization (dir mode)  | 500-2000ms | Reads all files      |
| Save snapshot (file mode)        | 20-50ms    | Full file rewrite    |
| Save snapshot (dir mode)         | 2-5ms      | Single file write    |
| Rule matching (50 rules)         | 5-20ms     | All rules evaluated  |
| Body cloning (1MB)               | 10-50ms    | Full stringify/parse |
| URL normalization                | 0.1-1ms    | Per request          |
| Body hashing                     | 1-5ms      | Per POST/PUT/PATCH   |
| Near-match search                | 10-50ms    | Per request (O(n))   |

### Total Test Impact

**File Mode (Record)**:

- 100 API calls × 25ms avg save = **2.5 seconds** just for file writes
- 100 API calls × 30ms near-match search = **3 seconds** wasted
- Plus initialization: **50-200ms**
- **Total: ~5.5-6 seconds overhead**

**Directory Mode (Record)**:

- 100 API calls × 3ms avg save = **300ms** for writes
- 100 API calls × 30ms near-match search = **3 seconds** wasted
- Plus initialization: **500-2000ms**
- **Total: ~3.8-5.3 seconds overhead**

**Mock Mode**:

- Fast lookups: **<1ms per request**
- But 100 API calls × 30ms near-match = **3 seconds** wasted
- Initialization still slow in directory mode

---

## 🎯 Optimization Priority

### Priority 1: Critical (Do First)

1. ✅ **Batch/debounce file writes** in file mode
2. ✅ **Lazy load snapshots** in directory mode
3. ✅ **Async file operations** in constructor

### Priority 2: High Impact

4. ✅ **Optimize near-match search** (index by normalizedUrl)
5. ✅ **Cache normalized URLs**
6. ✅ **Short-circuit rule matching**
7. ✅ **Optimize body cloning**

### Priority 3: Nice to Have

7. ✅ **Cache body hashes**
8. ✅ **Index file for directory mode**
9. ✅ **Write queue for concurrent access**

---

## 🔧 Implementation Recommendations

### 1. Write Batching

```typescript
private writeQueue: Set<string> = new Set();
private writeTimer: NodeJS.Timeout | null = null;

saveEntry(snapshot: SnapshotEntry) {
  this.entries[snapshot.key] = snapshot;
  this.writeQueue.add(snapshot.key);

  if (this.storageType === "file") {
    // Debounce: only write after 100ms of no activity
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.flushWrites();
    }, 100);
  } else {
    this.writeToDirectory(snapshot);
  }
}
```

### 2. Lazy Loading

```typescript
private loadedKeys = new Set<string>();

getStoredSnapshot(key: string): SnapshotEntry | undefined {
  if (this.entries[key]) return this.entries[key];

  // Lazy load from disk
  if (this.storageType === "dir" && !this.loadedKeys.has(key)) {
    const filePath = this.directoryIndex[key];
    if (filePath) {
      const entry = this.loadFromDisk(filePath);
      if (entry) {
        this.entries[key] = entry;
        this.loadedKeys.add(key);
        return entry;
      }
    }
  }
  return undefined;
}
```

### 3. Near-Match Index

```typescript
private normalizedUrlIndex = new Map<string, Set<string>>();

// Build index on initialization
private buildIndex() {
  for (const [key, entry] of Object.entries(this.entries)) {
    const normalized = entry.request.normalizedUrl;
    if (!this.normalizedUrlIndex.has(normalized)) {
      this.normalizedUrlIndex.set(normalized, new Set());
    }
    this.normalizedUrlIndex.get(normalized)!.add(key);
  }
}

// Fast lookup
private findNearMatch(normalizedUrl: string): SnapshotEntry | undefined {
  const keys = this.normalizedUrlIndex.get(normalizedUrl);
  if (!keys || keys.size === 0) return undefined;
  // Return first matching entry
  const firstKey = keys.values().next().value;
  return this.entries[firstKey];
}
```

### 4. URL Normalization Cache

```typescript
private urlCache = new Map<string, string>();

private async normalizeUrl(...) {
  const cacheKey = `${rawUrl}:${JSON.stringify(config.urlNormalization)}`;
  if (this.urlCache.has(cacheKey)) {
    return this.urlCache.get(cacheKey)!;
  }

  const normalized = normalizeUrlDefault(rawUrl, config.urlNormalization);
  // ... apply overrides ...

  this.urlCache.set(cacheKey, normalized);
  return normalized;
}
```

---

## 📝 Best Practices for Large Projects

1. **Use Directory Mode**: Better for parallel execution, incremental updates
2. **Separate Snapshots by Test Suite**: Reduces file size in file mode
3. **Limit Snapshot Size**: Use `onRecordResponse` to strip unnecessary data
4. **Reuse Store Instances**: Don't create new store per test if possible
5. **Monitor Performance**: Add timing logs in development mode
6. **Consider Snapshot Cleanup**: Remove unused snapshots periodically

---

## 🧪 Performance Testing

Recommended benchmarks:

- Initialize store with 1000 snapshots
- Save 100 new snapshots sequentially
- Save 100 new snapshots in parallel (10 workers)
- Lookup 1000 random snapshots
- Full test suite with 500 tests

Target metrics:

- Store init: < 100ms (file mode), < 500ms (dir mode)
- Save operation: < 5ms average
- Lookup operation: < 0.1ms average
