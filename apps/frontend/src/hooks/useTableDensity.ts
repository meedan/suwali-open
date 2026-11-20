import { useCallback, useState } from 'react';

export type Density = 'compact' | 'comfortable';

const DEFAULT_DENSITY: Density = 'compact';

const STORAGE_KEY = 'suwali-table-density';

const readDensity = (): Density => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'compact' || stored === 'comfortable' ? stored : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
};

export function useTableDensity() {
  const [density, setDensityState] = useState<Density>(readDensity);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is unavailable, so the choice only lasts for this visit
    }
  }, []);

  return [density, setDensity] as const;
}
