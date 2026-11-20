import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { ABSOLUTE_MIN_SUBSCRIBERS } from "@helpers/subscribedTopics";

import { fetchStatistics, type SubscribedTopic } from "@services/HubService";

import SubscribedTopicsWidget from "./SubscribedTopicsWidget";

vi.mock("@services/HubService", () => ({ fetchStatistics: vi.fn() }));

// happy-dom reports a zero-sized container, which makes recharts throw
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: () => null,
  Line: () => null,
  LineChart: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: () => null,
}));

vi.mock("@hooks/useHubSetupTasks", () => ({
  useHubSetupTasks: () => ({ messagingPlatformConnected: true, isPending: false }),
}));

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({ currentHub: () => ({ id: 1 }), currentHubId: () => 1 }),
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

const renderComponent = (onExpand?: () => void) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <SubscribedTopicsWidget onExpand={onExpand} />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("SubscribedTopicsWidget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("headlines the quiet topic with the biggest audience and how long it has been waiting", async () => {
    mockTopics([
      topic("Vaccine access", 480, quietFor(5)),
      topic("Press freedom", 360, quietFor(11)),
      topic("Elections", 900, quietFor(0)),
    ]);

    renderComponent();

    expect(await screen.findByText("Vaccine access")).toBeInTheDocument();
    expect(screen.getByText("480 subscribers")).toBeInTheDocument();
    expect(screen.getByText("5th week without a new document")).toBeInTheDocument();
    expect(screen.getByText(/Recently quiet topics/)).toBeInTheDocument();
  });

  it("reports every topic as covered when none has gone quiet long enough", async () => {
    mockTopics([topic("Elections", 900, quietFor(1))]);

    renderComponent();

    expect(await screen.findByText("Audience up to date")).toBeInTheDocument();
    expect(screen.getByText("All topics have new documents added in the past 3 months.")).toBeInTheDocument();
    expect(screen.queryByText(/week without a new document/)).not.toBeInTheDocument();
  });

  it("asks for more subscribers when no audience is big enough to flag", async () => {
    mockTopics([topic("Vaccine access", ABSOLUTE_MIN_SUBSCRIBERS - 1, quietFor(5))]);

    renderComponent();

    expect(await screen.findByText("Still building an audience")).toBeInTheDocument();
    expect(screen.getByText(/Not enough subscribers yet/)).toBeInTheDocument();
  });

  it("explains the empty state when nobody has subscribed", async () => {
    mockTopics([]);

    renderComponent();

    expect(await screen.findByText("No subscriptions yet")).toBeInTheDocument();
    expect(screen.getByText(/No one has subscribed to topic updates/)).toBeInTheDocument();
  });

  it("has no details to offer a hub without an audience to describe", async () => {
    mockTopics([topic("Vaccine access", ABSOLUTE_MIN_SUBSCRIBERS - 1, quietFor(5))]);

    renderComponent(() => {});

    expect(await screen.findByText("Still building an audience")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand to show details" })).not.toBeInTheDocument();
  });

  it("offers the details of a hub whose topics are all up to date", async () => {
    mockTopics([topic("Elections", 900, quietFor(1))]);

    renderComponent(() => {});

    expect(await screen.findByRole("button", { name: "Expand to show details" })).toBeInTheDocument();
  });
});
