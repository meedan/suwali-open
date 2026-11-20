import { useCallback, useEffect, useRef } from 'react';

import { usePageVisibility } from '@hooks/usePageVisibility';

// How long to wait before each look at an item, which backs off; the last wait repeats
const WAITS_MS = [3000, 5000, 8000, 10000];
// Of the time the tab is visible; a row still pending after it settles when its list is next fetched
const GIVE_UP_AFTER_MS = 2 * 60 * 1000;

type Params<T> = {
  // The sync status of the item now, or undefined when it can't be told
  fetchStatus: (item: T) => Promise<string | undefined>;
  onSettled: (item: T, status: string) => void;
};

// Watches the few items the user has just set processing until they have been processed, so that their rows are not left
// locked as pending. Not the whole list, which a bulk import could leave pending in the hundreds.
export function useSyncStatusSettling<T>({ fetchStatus, onSettled }: Params<T>) {
  const isVisible = usePageVisibility();
  const latest = useRef({ fetchStatus, onSettled, isVisible });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Which watch of an item is the current one, so that a look still under way for an earlier watch is let go
  const generations = useRef(new Map<string, number>());
  const mounted = useRef(false);

  useEffect(() => {
    latest.current = { fetchStatus, onSettled, isVisible };
  });

  useEffect(() => {
    const pending = timers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return useCallback((key: string, item: T) => {
    clearTimeout(timers.current.get(key));
    const generation = (generations.current.get(key) ?? 0) + 1;
    generations.current.set(key, generation);
    let visibleWaitedMs = 0;

    const schedule = (attempt: number) => {
      const wait = WAITS_MS[Math.min(attempt, WAITS_MS.length - 1)];

      timers.current.set(key, setTimeout(async () => {
        // A hidden tab is not looked at, nor counted against the time to give up
        if (latest.current.isVisible) {
          visibleWaitedMs += wait;
          const status = await latest.current.fetchStatus(item);
          if (!mounted.current || generations.current.get(key) !== generation) return;
          if (status && status !== 'pending') {
            timers.current.delete(key);
            latest.current.onSettled(item, status);
            return;
          }
          if (visibleWaitedMs >= GIVE_UP_AFTER_MS) {
            timers.current.delete(key);
            return;
          }
        }
        schedule(attempt + 1);
      }, wait));
    };

    schedule(0);
  }, []);
}
