import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { Contribution } from "@customTypes/contribution";
import type { Message } from "@customTypes/message";

import { fetchContributions } from "@services/ContributionsService";
import { fetchStatistics } from "@services/HubService";

import { ToastProvider } from "@hooks/useToast";

import ContributionsChart from "./ContributionsChart";

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({
    currentHub: () => hub,
    currentHubId: () => 1,
  }),
}));

vi.mock("@hooks/useCapabilities", () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock("@services/HubService", () => ({
  fetchStatistics: vi.fn(),
}));

vi.mock("@services/ContributionsService", () => ({
  fetchContribution: vi.fn(),
  fetchContributions: vi.fn(),
  retryContributionSync: vi.fn(),
}));

vi.mock("@services/DocumentsService", () => ({
  fetchDocument: vi.fn(),
  retryDocumentSync: vi.fn(),
  refreshDocument: vi.fn(),
}));

vi.mock("@services/NotebooksService", () => ({
  fetchNotebooks: vi.fn(),
  fetchNotebookItems: vi.fn(),
  fetchNotebookSummary: vi.fn(),
  mutateAddToNotebook: vi.fn(),
  mutateRemoveFromNotebook: vi.fn(),
  retryNotebookSync: vi.fn(),
}));

vi.mock("@services/SourcesService", () => ({
  fetchSource: vi.fn(),
  updateEntityPriorityTier: vi.fn(),
  updateEntityActiveStatus: vi.fn(),
  deleteEntity: vi.fn(),
}));

// happy-dom reports a zero-sized container, which makes recharts throw. Tooltip is mocked to
// call its own formatter/labelFormatter functions directly, so the formatting logic it renders
// is still exercised.
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CartesianGrid: () => null,
  Tooltip: ({ formatter, labelFormatter }: {
    formatter: (value: number, name: string, entry: { dataKey: string, value: number, color: string }) => React.ReactNode,
    labelFormatter: (label: string) => React.ReactNode,
  }) => {
    const payload = [
      { dataKey: 'returning', value: 12, color: 'var(--color-purple-67)' },
      { dataKey: 'new', value: 4, color: 'var(--color-orange-59)' },
    ];
    return (
      <>
        {labelFormatter('2026-08-17')}
        {payload.flatMap(entry => formatter(entry.value, entry.dataKey, entry))}
      </>
    );
  },
  XAxis: () => null,
  YAxis: () => null,
}));

const hub = {
  id: 1,
  contribution_audience: 'all_end_users',
  contribution_code: '#contrib5590',
  contribution_workflow_mode: 'direct',
};

let nextContributionId = 1;

const buildContribution = (overrides: Partial<Contribution> = {}): Contribution => ({
  id: nextContributionId++,
  ai_summary: '',
  content: 'How do I reset my password?',
  created_at: '2026-08-17T00:00:00Z',
  first_contribution_at: '2026-08-17T00:00:00Z',
  first_time_contributor: false,
  hub_id: 1,
  message_id: 1,
  updated_at: '2026-08-17T00:00:00Z',
  priority_tier: 1,
  active: true,
  sync_status: 'complete',
  message: {
    conversation_id: 10,
    conversation: {
      id: 10,
      platform: 'whatsapp',
      participant: { name: 'Jane Doe' },
    },
  } as Message,
  ...overrides,
});

const mockWeeks = (weeks: { date: string, new: number, returning: number }[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-08-17', '2026-08-24'],
    contributions_by_contributor: weeks,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const mockContributions = (contributions: Contribution[]) =>
  vi.mocked(fetchContributions).mockResolvedValue({
    data: contributions,
    pagination: {
      current_page: 1, per_page: 20, total_pages: 1, total_count: contributions.length,
      next_page: null, prev_page: null, first_page: true, last_page: true,
    },
  });

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              <ContributionsChart onClose={() => {}} />
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("ContributionsChart", () => {
  it("summarizes the past week's contributions split between returning and first-time contributors", async () => {
    mockWeeks([{ date: '2026-08-17', new: 10, returning: 105 }]);
    mockContributions([]);

    renderComponent();

    expect(await screen.findByText("115 contributions in the past week")).toBeInTheDocument();
    expect(screen.getByText(
      (_, element) => element?.tagName.toLowerCase() === "span"
        && element.textContent === "105 from returning end-users and 10 from first-time contributors."
    )).toBeInTheDocument();
  });

  it("explains the empty state, and still closes, when the hub has never received a contribution", async () => {
    mockWeeks([{ date: '2026-08-17', new: 0, returning: 0 }]);
    mockContributions([]);

    renderComponent();

    expect(await screen.findByText("Your audience has not contributed anything yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close details" })).toBeInTheDocument();
  });

  it("lists each contribution with its content and the participant's name", async () => {
    mockWeeks([{ date: '2026-08-17', new: 0, returning: 0 }]);
    mockContributions([
      buildContribution({ content: "How do I reset my password?" }),
      buildContribution({ content: "Where can I find my invoice?" }),
    ]);

    renderComponent();

    expect(await screen.findByText("How do I reset my password?")).toBeInTheDocument();
    expect(screen.getByText("Where can I find my invoice?")).toBeInTheDocument();
    expect(screen.getAllByText("Jane Doe")).toHaveLength(2);
  });
});
