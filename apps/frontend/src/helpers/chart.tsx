import type { IntlShape } from 'react-intl';
import type { TooltipPayloadEntry } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

export const CHART_VISUAL_CONSTANTS = {
  DOT_RADIUS: 3,
  ACTIVE_DOT_RADIUS: 5,
  MARGINS: { top: 0, right: 0, bottom: 0, left: 0 },
  STROKE_WIDTH: 2,
  AXIS_WIDTH: 64,
  AXIS_TICK: { fill: 'var(--text-color-secondary)', fontSize: 12 },
  // Ticks, plus the room a scatter plot's quadrant labels are pulled back up into
  AXIS_TICK_ROOM: 44,
  AREA_STROKE_WIDTH: 2,
  AREA_FILL_OPACITY: 0.2,
  BRUSH_TRAVELLER_WIDTH: 8,
};

export const TOOLTIP_STYLES = {
  CONTENT: {
    backgroundColor: "var(--text-color-primary)",
    color: "var(--background-color-bg0)",
    borderRadius: 8,
    border: "none",
    boxShadow: "var(--drop-shadow)",
    padding: 8,
  },
  ITEM: {
    color: "var(--background-color-bg0)",
  },
  LABEL: {
    color: "var(--background-color-bg0)",
    fontWeight: "var(--font-weight-semibold)",
    marginBottom: 4,
  },
};

export interface DotProps {
  cx?: number;
  cy?: number;
  index: number;
  payload: Record<string, number | string>;
}

export interface CustomTickProps {
  x: number | string;
  y: number | string;
  payload: { value: string };
  index: number;
  visibleTicksCount: number;
  formatter: (value: string) => string;
}

/**
 * Calculate Y-axis domain with 10% padding above max value so there is some visual room
 * Returns 1 if dataMax is 0 to avoid empty charts
 */
export const calculateYAxisDomain = (dataMax: number): number => {
  return dataMax === 0 ? 1 : Math.ceil(dataMax * 1.1);
};

// Statistics buckets are labelled with UTC date-only strings, so they are parsed and rendered in
// UTC: formatting one against the local clock shows the previous day anywhere west of Greenwich.
const utcDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);

export const formatDay = (day: string, intl: IntlShape): string =>
  intl.formatDate(utcDay(day), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const formatDayShort = (day: string, intl: IntlShape): string =>
  intl.formatDate(utcDay(day), { month: "short", day: "numeric", timeZone: "UTC" });

// recharts' Tooltip formatter expects a [value, name] tuple; folding both into a single
// colored-dot row (and returning null for the second slot) is how every chart here renders one.
export const renderTooltipRow = (
  key: string,
  color: string,
  content: React.ReactNode,
  indicator: React.ReactNode = '⬤',
): [React.ReactNode, null] => [
  <span key={key}>
    <span style={{ color }}>{indicator} </span>
    <span>{content}</span>
  </span>,
  null,
];

// A Tooltip `formatter` for a stacked bar chart of plain counts, one colored-dot row per series —
// shared by every chart on the platform-admin analytics page so they render tooltips identically.
// `colors` keys on the same dataKey each Bar uses; `name` is whatever that Bar's own `name` prop is.
export const makeCountTooltipFormatter = (colors: Record<string, string>, intl: IntlShape) =>
  (value: ValueType | undefined, name: NameType | undefined, entry: TooltipPayloadEntry): [React.ReactNode, null] | null => {
    if (typeof value !== 'number' || typeof entry.dataKey !== 'string') return null;
    return renderTooltipRow(entry.dataKey, colors[entry.dataKey] ?? '', `${name}: ${intl.formatNumber(value)}`);
  };
