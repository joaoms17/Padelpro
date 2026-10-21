// Keeping loads and writes in order: a load that started before a write
// finished may not have seen it, so it must not overwrite what the write
// left on screen. Pure and testable.

let clock = 0;

/** A counter shared by loads and writes (each call is later than the one before). */
export function nextStamp(): number {
  return ++clock;
}

/**
 * Numbers each request: only the latest one started may apply its result,
 * so an older, slower load finishing last never brings back stale data.
 */
export function latestOnly() {
  let last = 0;
  return {
    start: () => ++last,
    isLatest: (id: number) => id === last,
  };
}
