import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { fetchStatistics } from "@services/HubService";

import TopicsWidget from "./TopicsWidget";

vi.mock("@services/HubService", () => ({
  fetchStatistics: vi.fn(),
}));

// happy-dom reports a zero-sized container, which makes recharts throw
vi.mock("recharts", () => ({
  Line: () => null,
  LineChart: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: () => null,
}));

vi.mock("@hooks/useHubSetupTasks", () => ({
  useHubSetupTasks: () => ({ messagingPlatformConnected: true, isPending: false }),
}));

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({
    currentHub: () => ({ id: 1 }),
    currentHubId: () => 1,
  }),
}));

// The trend label wraps part of its text in <strong>, so the full sentence is split across
// nodes. Match the element whose full textContent equals the sentence but whose children don't
// (otherwise both the wrapping element and its ancestors would match).
const hasTextContent = (text: string) => (_: string, element: Element | null) => {
  if (!element) return false;
  const nodeHasText = (node: Element) => node.textContent === text;

  return nodeHasText(element) && Array.from(element.children).every((child) => !nodeHasText(child));
};

const mockTopics = (topics: unknown[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-03-01', '2026-08-24'],
    top_topics: topics,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <TopicsWidget />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("TopicsWidget", () => {
  it("renders the top topic with this month’s asks, documents and the change from last month", async () => {
    // Eight weekly buckets: the last four total 60 more asks than the four before them, and the
    // headline reads the last bucket of each series
    mockTopics([
      {
        id: 12,
        name: "Deepfake detection",
        messages: {
          '2026-07-01': 175, '2026-07-08': 175, '2026-07-15': 175, '2026-07-22': 175,
          '2026-07-29': 100, '2026-08-05': 130, '2026-08-12': 150, '2026-08-19': 380,
        },
        data_source_items: {
          '2026-07-01': 3, '2026-07-08': 3, '2026-07-15': 3, '2026-07-22': 3,
          '2026-07-29': 2, '2026-08-05': 2, '2026-08-12': 2, '2026-08-19': 2,
        },
      },
    ]);

    renderComponent();

    expect(await screen.findByText("Deepfake detection")).toBeInTheDocument();
    expect(screen.getByText("380 asks this month, using 2 documents")).toBeInTheDocument();
    expect(screen.getByText(hasTextContent("60 times vs last month"))).toBeInTheDocument();
  });

  it("explains the empty state when no topic was asked about this month", async () => {
    mockTopics([]);

    renderComponent();

    expect(await screen.findByText(/will be available when received from your audience/)).toBeInTheDocument();
    expect(screen.queryByText(/vs last month/)).not.toBeInTheDocument();
  });
});
