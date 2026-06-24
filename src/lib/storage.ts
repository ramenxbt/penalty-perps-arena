/**
 * Tiny SSR-safe localStorage helper. JSON get/set wrapped in try/catch so a missing
 * window (server render), disabled storage, quota error, or corrupt value never throws
 * into game logic. Used by the local backend to persist the player's own progression.
 */

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Read and parse a JSON value, or return `fallback` on any miss/error. */
export function readJson<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Serialize and write a JSON value. Silently no-ops on any error. */
export function writeJson(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or quota exceeded; progression simply will not persist.
  }
}
