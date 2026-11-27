/**
 * Small in-memory cache for the lists of teams and players.
 *
 * Opening "Anagrafe Calciatore", "Anagrafe Squadra", "Formazione" or the
 * calendar used to download the same teams, seasons and squads again every
 * time. Lists are now reused for a short time and thrown away as soon as
 * anything is written, so the screens open instantly and never show old data
 * after a change made in this app.
 */
let version = 0;
const MAX_AGE_MS = 90_000;
const entries = new Map<string, { version: number; at: number; value: Promise<unknown> }>();

export function invalidateData(): void {
  version++;
  entries.clear();
}

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < MAX_AGE_MS) return hit.value as Promise<T>;
  const startedAt = version;
  const value = withRetry(load);
  entries.set(key, { version: startedAt, at: Date.now(), value });
  value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
  return value;
}

/**
 * Wraps the given write methods of a service so that every write
 * (before and after it completes) invalidates the cached lists.
 */
export function invalidateOnWrite(service: object, methods: string[]): void {
  const target = service as Record<string, unknown>;
  for (const name of methods) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = async (...args: unknown[]) => {
      invalidateData();
      try { return await (original as (...a: unknown[]) => Promise<unknown>).apply(service, args); }
      finally { invalidateData(); }
    };
  }
}

/** A failed download is tried again (up to 3 times) before the screen shows an error. */
async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await load(); }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1))); }
  }
  throw lastError;
}
