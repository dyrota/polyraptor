// Minimal external store, meant to be read via React's useSyncExternalStore.
// WebMCP tool `execute()` functions are plain module-level async functions
// registered once at mount — they aren't React components and have no hooks
// of their own, so they need a way to push state that React can react to.
// This tiny pub-sub is that seam, kept dependency-free on purpose.

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: (): T => state,
    setState: (updater: T | ((prev: T) => T)) => {
      state = typeof updater === 'function' ? (updater as (prev: T) => T)(state) : updater;
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
