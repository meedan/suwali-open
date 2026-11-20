import { useEffect, useState } from 'react';

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
};

export const useIsMobileScreen = (breakpoint = '500px') => useMediaQuery(`(max-width: ${breakpoint})`);

export const useIsTabletScreen = (breakpoint = '850px') => useMediaQuery(`(min-width: ${breakpoint})`);

export const useIsInTabletRange = (minBreakpoint = '501px', maxBreakpoint = '850px') =>
  useMediaQuery(`(min-width: ${minBreakpoint}) and (max-width: ${maxBreakpoint})`);

export const useResponsiveDrawer = (breakpoint = '850px') => {
  const isTabletScreen = useIsTabletScreen(breakpoint);
  const [isOpen, setIsOpen] = useState(isTabletScreen);

  useEffect(() => {
    setIsOpen(isTabletScreen);
  }, [isTabletScreen]);

  return [isOpen, setIsOpen] as const;
};

type DashboardLayoutTier = 'oneColumn' | 'twoColumn' | 'threeColumn';

export const useDashboardLayoutTier = (minBreakpoint = '1000px', maxBreakpoint = '1400px'): DashboardLayoutTier => {
  const isOneColumn = useMediaQuery(`(max-width: ${minBreakpoint})`);
  const isTwoColumn = useMediaQuery(`(min-width: ${minBreakpoint}) and (max-width: ${maxBreakpoint})`);

  if (isOneColumn) return 'oneColumn';
  if (isTwoColumn) return 'twoColumn';
  return 'threeColumn';
};
