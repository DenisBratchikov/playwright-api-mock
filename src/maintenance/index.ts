import type { SnapshotEntry } from "../core/types";

export interface ValidationResult {
  issues: string[];
}

/**
 * Basic validation for duplicate or malformed snapshot entries.
 */
export const validateSnapshots = (
  entries: SnapshotEntry[]
): ValidationResult => {
  const seenKeys = new Set<string>();
  const issues: string[] = [];
  for (const entry of entries) {
    if (seenKeys.has(entry.key)) {
      issues.push(`Duplicate key: ${entry.key}`);
    }
    seenKeys.add(entry.key);
    if (!entry.request.normalizedUrl) {
      issues.push(`Missing normalizedUrl for key ${entry.key}`);
    }
    if (!entry.request.method) {
      issues.push(`Missing method for key ${entry.key}`);
    }
  }
  return { issues };
};

/**
 * Snapshot statistics grouped by endpoint and variant.
 */
export const snapshotStats = (entries: SnapshotEntry[]) => {
  const byEndpoint: Record<string, number> = {};
  const byVariant: Record<string, number> = {};

  for (const entry of entries) {
    byEndpoint[entry.request.normalizedUrl] =
      (byEndpoint[entry.request.normalizedUrl] ?? 0) + 1;
    const variantKey = entry.request.variant ?? "default";
    byVariant[variantKey] = (byVariant[variantKey] ?? 0) + 1;
  }

  return {
    total: entries.length,
    byEndpoint,
    byVariant,
  };
};
