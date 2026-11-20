import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { fetchStatistics, type SubscribedTopic } from "@services/HubService";

import SubscribedTopicsChart from "./SubscribedTopicsChart";

vi.mock("@services/HubService", () => ({ fetchStatistics: vi.fn() }));

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

// happy-dom reports a zero-sized container, which makes recharts throw
vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
  Scatter: () => null,
  ScatterChart: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const topic = (name: string, subscribers: number, documents: number[]): SubscribedTopic => ({
  id: name.length,
  name,
  subscribers,
  documents: Object.fromEntries(documents.map((count, week) => [`2026-06-${String(week + 1).padStart(2, '0')}`, count])),
});

const quietFor = (silent: number) => [...Array(12 - silent).fill(1), ...Array(silent).fill(0)];

const mockTopics = (topics: SubscribedTopic[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-06-01', '2026-08-31'],
    subscribed_topics: topics,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <SubscribedTopicsChart onClose={() => {}} />
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("SubscribedTopicsChart", () => {
  it("ranks every subscribed topic by audience size, with how long each has been silent", async () => {
    mockTopics([
      topic("Deepfake detection", 380, quietFor(12)),
      topic("Vaccine access", 480, quietFor(1)),
      topic("Press freedom", 202, quietFor(5)),
    ]);

    renderComponent();

    // The separators are their own elements rather than CSS content, so no whitespace survives in
    // textContent. The first row is the table header, which this ranking doesn't cover.
    const [, ...rows] = await screen.findAllByRole("row");
    expect(rows.map(row => row.textContent)).toEqual([
      "Vaccine access480 subscribers•1 wk silent",
      "Deepfake detection380 subscribers•12 wks silent",
      "Press freedom202 subscribers•5 wks silent",
    ]);
  });

  it("explains the empty state, and still closes, when nobody has subscribed to a topic", async () => {
    mockTopics([]);

    renderComponent();

    expect(await screen.findByText("Your audience has not subscribed to a topic yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close details" })).toBeInTheDocument();
  });
});
