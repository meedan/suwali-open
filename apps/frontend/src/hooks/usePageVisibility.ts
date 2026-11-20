import { useEffect, useState } from 'react';

// Tracks whether the browser tab is currently visible, so callers (e.g. polling
// intervals) can pause work while the user isn't looking at the tab.
export const usePageVisibility = () => {
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return isVisible;
};
