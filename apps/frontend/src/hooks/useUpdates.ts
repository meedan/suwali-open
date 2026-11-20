import { useCallback, useEffect, useState } from 'react';

import { updates } from '@pages/updates/updates';

const STORAGE_KEY = 'updatesRead';

const saveReadIds = (ids: Set<string>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
};

const loadReadIds = (): Set<string> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      return new Set(JSON.parse(stored) as string[]);
    }
    // First time this user encounters the feature: mark all existing updates as read
    // so only updates published after they joined will appear as unread.
    const initial = new Set(updates.map(u => u.id));
    saveReadIds(initial);
    return initial;
  } catch {
    // Treat corrupt/unavailable storage the same as first visit.
    const initial = new Set(updates.map(u => u.id));
    saveReadIds(initial);
    return initial;
  }
};

// Module-level shared state so all hook instances on the same page stay in sync.
let sharedReadIds = loadReadIds();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(fn => fn());

export const useUpdates = () => {
  const [, rerender] = useState(0);

  useEffect(() => {
    const sub = () => rerender(n => n + 1);
    subscribers.add(sub);
    return () => { subscribers.delete(sub); };
  }, []);

  const unreadCount = updates.filter(u => !sharedReadIds.has(u.id)).length;

  const markAsRead = useCallback((id: string) => {
    if (sharedReadIds.has(id)) return;
    sharedReadIds = new Set(sharedReadIds);
    sharedReadIds.add(id);
    saveReadIds(sharedReadIds);
    notify();
  }, []);

  const markAllAsRead = useCallback(() => {
    sharedReadIds = new Set(updates.map(u => u.id));
    saveReadIds(sharedReadIds);
    notify();
  }, []);

  // Empty deps: sharedReadIds is module-level so the callback always reads the current reference.
  const isRead = useCallback((id: string) => sharedReadIds.has(id), []);

  return { isRead, markAllAsRead, markAsRead, unreadCount };
};
