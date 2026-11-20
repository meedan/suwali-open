import React from "react";
import {
  Area,
  AreaChart,
  Brush,
  ComposedChart,
} from "recharts";

import { CHART_VISUAL_CONSTANTS } from '@helpers/chart';

import styles from './LineChart.module.css';

const BRUSH_DEBOUNCE_MS = 200;
const CONTEXT_CHART_HEIGHT = 70;

interface BrushRange {
  startIndex: number;
  endIndex: number;
}

interface BrushChangeEvent {
  startIndex?: number;
  endIndex?: number;
}

interface ContextChartProps {
  data: Array<Record<string, number | string>>;
  brushRange: BrushRange;
  onRangeChange: (startIndex: number, endIndex: number) => void;
  formatDayShort: (day: string) => string;
}

export default function ContextChart({
  data,
  brushRange,
  onRangeChange,
  formatDayShort
}: ContextChartProps) {
  const debounceTimerRef = React.useRef<number | null>(null);

  const handleBrushChange = React.useCallback((range: BrushChangeEvent) => {
    if (!range || range.startIndex === undefined || range.endIndex === undefined) {
      return;
    }

    const maxIndex = data.length - 1;
    const snappedStartIndex = Math.round(range.startIndex);
    const snappedEndIndex = Math.min(Math.ceil(range.endIndex), maxIndex);

    // Clear any existing timer
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to update state only after dragging stops
    debounceTimerRef.current = window.setTimeout(() => {
      onRangeChange(snappedStartIndex, snappedEndIndex);
    }, BRUSH_DEBOUNCE_MS);
  }, [data.length, onRangeChange]);

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.contextChart}>
      <ComposedChart className={styles.brushWrapper} syncId="conversationChart" data={data} margin={CHART_VISUAL_CONSTANTS.MARGINS} responsive width="100%" height={CONTEXT_CHART_HEIGHT}>
        <Brush
          dataKey="day"
          height={CONTEXT_CHART_HEIGHT}
          stroke="transparent"
          travellerWidth={CHART_VISUAL_CONSTANTS.BRUSH_TRAVELLER_WIDTH}
          fill="none"
          tickFormatter={formatDayShort}
          startIndex={brushRange.startIndex}
          endIndex={brushRange.endIndex}
          onChange={handleBrushChange}
        />
      </ComposedChart>
      <div className={styles.areaIt}>
        <AreaChart responsive data={data} width="100%" height={CONTEXT_CHART_HEIGHT} margin={CHART_VISUAL_CONSTANTS.MARGINS}>
          <Area
            type="linear"
            dataKey="conversations_total"
            stroke="var(--color-purple-67)"
            fill="var(--color-purple-67)"
            fillOpacity={CHART_VISUAL_CONSTANTS.AREA_FILL_OPACITY}
            strokeWidth={CHART_VISUAL_CONSTANTS.AREA_STROKE_WIDTH}
            isAnimationActive={false}
          />
        </AreaChart>
      </div>
    </div>
  );
}
