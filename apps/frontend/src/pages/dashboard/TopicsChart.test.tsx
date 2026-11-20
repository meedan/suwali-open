import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { fetchStatistics } from "@services/HubService";

import TopicsChart from "./TopicsChart";

vi.mock("@services/HubService", () => ({
  fetchStatistics: vi.fn(),
}));

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({
    currentHubId: () => 1,
  }),
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

let nextTopicId = 1;
const topic = (name: string, asks: number, documents: number) => ({
  id: nextTopicId++,
  name,
  messages: { '2026-07-26': asks },
  data_source_items: { '2026-07-26': documents },
});

const mockTopics = (topics: unknown[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-07-26', '2026-08-25'],
    top_topics: topics,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TopicsChart onClose={() => {}} />
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("TopicsChart", () => {
  it("ranks the table by asks per document and shows a dash when nothing answered a topic", async () => {
    mockTopics([
      topic("Digital Media", 22, 1),
      topic("Deepfake detection", 380, 2),
      topic("Uncovered", 40, 0),
    ]);

    renderComponent();

    // The separators are their own elements rather than CSS content, so no whitespace survives in
    // textContent. The first row is the table header, which this ranking doesn't cover.
    const [, ...rows] = await screen.findAllByRole("row");
    expect(rows.map(row => row.textContent)).toEqual([
      "Uncovered40 asks•0 docs•- / doc",
      "Deepfake detection380 asks•2 docs•190 / doc",
      "Digital Media22 asks•1 doc•22 / doc",
    ]);
  });

  it("explains the empty state, and still closes, when the hub has no topics in the period", async () => {
    mockTopics([]);

    renderComponent();

    expect(await screen.findByText("Your audience has not asked about any topics in this period.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close details" })).toBeInTheDocument();
  });
});
