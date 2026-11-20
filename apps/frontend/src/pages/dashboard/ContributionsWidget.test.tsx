import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { ContributionsByContributor } from "@customTypes/statistics";

import { fetchHubTrustedEndUsers, fetchStatistics } from "@services/HubService";

import ContributionsWidget from "./ContributionsWidget";

vi.mock("@services/HubService", () => ({
  fetchHubTrustedEndUsers: vi.fn(),
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

const hub = { id: 1, contribution_audience: 'all_end_users', contribution_code: '#contrib5590' };

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({
    currentHub: () => hub,
    currentHubId: () => 1,
  }),
}));

// getByText's default matcher only checks single text nodes, but the trend label splits "-5%" and
// "vs last week" across separate nodes. Match the element whose full textContent equals the
// sentence but whose children don't (otherwise both it and its ancestors would match).
const hasTextContent = (text: string) => (_: string, element: Element | null) => {
  if (!element) return false;
  const nodeHasText = (node: Element) => node.textContent === text;

  return nodeHasText(element) && Array.from(element.children).every((child) => !nodeHasText(child));
};

const mockWeeks = (weeks: ContributionsByContributor[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-05-26', '2026-08-24'],
    contributions_by_contributor: weeks,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ContributionsWidget />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("ContributionsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hub.contribution_audience = 'all_end_users';
  });

  it("reports the last week alone, not the last month, against the week before it", async () => {
    mockWeeks([
      { date: '2026-07-27', new: 5, returning: 100 },
      { date: '2026-08-03', new: 5, returning: 100 },
      { date: '2026-08-10', new: 11, returning: 110 },
      { date: '2026-08-17', new: 10, returning: 105 },
    ]);

    renderComponent();

    expect(await screen.findByText("115")).toBeInTheDocument();
    expect(screen.getByText("contributions in the past week")).toBeInTheDocument();
    expect(screen.getByText(hasTextContent("-5% vs last week"))).toBeInTheDocument();
    expect(screen.getByText("105 from returning end-users and 10 from first-time contributors.")).toBeInTheDocument();
  });

  it("points an anonymous hub at its contribution code when nothing has come in", async () => {
    mockWeeks([{ date: '2026-08-10', new: 0, returning: 0 }]);

    renderComponent();

    expect(await screen.findByText(/Share your contribution code/)).toBeInTheDocument();
    expect(screen.getByText("#contrib5590")).toBeInTheDocument();
    expect(screen.queryByText(/vs last week/)).not.toBeInTheDocument();
    expect(fetchHubTrustedEndUsers).not.toHaveBeenCalled();
  });

  it("points an allowlist hub at its allowlist while it is still empty", async () => {
    hub.contribution_audience = 'trusted_end_users';
    mockWeeks([{ date: '2026-08-10', new: 0, returning: 0 }]);
    vi.mocked(fetchHubTrustedEndUsers).mockResolvedValue([]);

    renderComponent();

    expect(await screen.findByText(/Add trusted end-users to your/)).toBeInTheDocument();
    expect(screen.queryByText(/Share your contribution code/)).not.toBeInTheDocument();
  });
});
