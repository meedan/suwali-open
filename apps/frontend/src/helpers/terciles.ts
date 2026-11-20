export type Tercile = 'bottom' | 'middle' | 'top';

export type TercileBounds = {
  lower: number;
  upper: number;
};

// Terciles split the axis into three equal ranges rather than into three equally sized groups of
// points. Quantile boundaries collapse onto the same value when most points share it — with two
// thirds of them on zero, every band would match every point.
export const tercileBounds = (max: number): TercileBounds =>
  ({ lower: max / 3, upper: (max * 2) / 3 });

export const inTercile = (value: number, tercile: Tercile, bounds: TercileBounds) => {
  if (tercile === 'bottom') return value <= bounds.lower;
  if (tercile === 'top') return value > bounds.upper;
  return value > bounds.lower && value <= bounds.upper;
};

export const inBand = (value: number, [from, to]: [number, number]) => value >= from && value <= to;

// The stretch of the axis a tercile covers. Shares its bounds with inTercile, so the highlighted
// band always contains exactly the points painted as belonging to it.
export const tercileBand = (tercile: Tercile, bounds: TercileBounds, max: number): [number, number] => {
  if (tercile === 'bottom') return [0, bounds.lower];
  if (tercile === 'top') return [bounds.upper, max];
  return [bounds.lower, bounds.upper];
};
