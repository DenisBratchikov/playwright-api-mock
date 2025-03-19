export const ensureError = (e: unknown) => (e instanceof Error ? e : new Error(`${e}`));
