import type { Density } from '@hooks/useTableDensity';

export const hasTopicsColumn = (density?: Density) => density !== 'comfortable';

export const withTopicsColumn = (columnCount: number, density?: Density) => (hasTopicsColumn(density) ? columnCount + 1 : columnCount);
