import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { TrendPeriod } from "./dashboardWidgets";
import {
  getPastMonthTotal,
  getPercentageChange,
  getSeriesAverage,
  getThisMonthTotal,
  getTrendColor,
  getTrendDirection,
  getTrendLabel,
  getTrendProps,
  rollingWeeks,
} from "./dashboardWidgets";

const sparkLineData = [
  { value: 10 },
  { value: 20 },
  { value: 30 },
  { value: 40 },
  { value: 50 },
  { value: 60 },
  { value: 70 },
  { value: 80 },
];

const renderTrendLabel = (period: TrendPeriod, direction: "up" | "down" | "nochange", comparisonValue: number | null) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      {getTrendLabel(period, direction, comparisonValue)}
    </IntlProvider>
  );

// The trend label wraps part of its text in <strong>, so the full sentence is split across
// nodes. Match the element whose full textContent equals the sentence but whose children don't
// (otherwise both the wrapping element and its ancestors would match).
const hasTextContent = (text: string) => (_: string, element: Element | null) => {
  if (!element) return false;
  const nodeHasText = (node: Element) => node.textContent === text;

  return nodeHasText(element) && Array.from(element.children).every((child) => !nodeHasText(child));
};

describe("dashboardWidgets helpers", () => {
  afterEach(() => vi.useRealTimers());

  // Counting back in local days would shift the window by one across a DST change
  it("covers whole seven-day periods ending yesterday", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-03-15T23:30:00Z"));

    expect(rollingWeeks(12)).toEqual({ from: "2025-12-21", to: "2026-03-14" });
  });

  it("ends a day behind whatever the weekday is, so the window is never part-finished", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-03-11T10:00:00Z"));

    expect(rollingWeeks(4)).toEqual({ from: "2026-02-11", to: "2026-03-10" });
  });

  it("calculates the average of a sparkline series", () => {
    expect(getSeriesAverage(sparkLineData)).toBe(45);
  });

  it("calculates totals for the current and previous month windows", () => {
    expect(getThisMonthTotal(sparkLineData)).toBe(260);
    expect(getPastMonthTotal(sparkLineData)).toBe(100);
  });

  it("computes the comparison percentage without dividing by zero", () => {
    expect(getPercentageChange(260, 100)).toBe(160);
    expect(getPercentageChange(80, 0)).toBeNull();
  });

  it("reports the correct direction and color for a trend", () => {
    expect(getTrendColor(260, 100)).toBe("green");
    expect(getTrendDirection(260, 100)).toBe("up");
    expect(getTrendColor(100, 260)).toBe("red");
    expect(getTrendDirection(100, 260)).toBe("down");
    expect(getTrendColor(100, 100)).toBe("neutral");
    expect(getTrendDirection(100, 100)).toBe("nochange");
  });

  it("renders the no-change label when there is no movement", () => {
    renderTrendLabel("month", "nochange", null);
    expect(screen.getByText("No change vs last month")).toBeInTheDocument();

    renderTrendLabel("week", "nochange", null);
    expect(screen.getByText("No change vs last week")).toBeInTheDocument();
  });

  it("renders the percentage comparison label for direction changes", () => {
    renderTrendLabel("month", "up", 125);
    expect(screen.getByText(hasTextContent("+125% vs past month"))).toBeInTheDocument();

    renderTrendLabel("month", "down", -40);
    expect(screen.getByText(hasTextContent("-40% vs past month"))).toBeInTheDocument();

    renderTrendLabel("week", "down", -5);
    expect(screen.getByText(hasTextContent("-5% vs last week"))).toBeInTheDocument();
  });

  // A month compares the last four buckets against the four before them; a week compares the last
  // bucket against the one before it
  it("sizes the comparison window to the period the widget reports on", () => {
    expect(getTrendProps(sparkLineData, "month")).toMatchObject({ current: 260, previous: 100, hasData: true });
    expect(getTrendProps(sparkLineData, "week")).toMatchObject({ current: 80, previous: 70, hasData: true });
  });

  it("reports no data when every bucket is empty, so the trend renders blank", () => {
    const { hasData, trend } = getTrendProps([{ value: 0 }, { value: 0 }], "week");

    expect(hasData).toBe(false);
    expect(trend).toMatchObject({ noData: true, label: false, referenceValue: 0 });
  });
});
