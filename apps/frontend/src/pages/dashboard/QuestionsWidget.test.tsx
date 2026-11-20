import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { QuestionsByAnswered } from "@customTypes/statistics";

import { fetchQuestionsRanking, fetchStatistics } from "@services/HubService";

import QuestionsWidget from "./QuestionsWidget";

vi.mock("@services/HubService", () => ({
  fetchQuestionsRanking: vi.fn(),
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

// getByText's default matcher only checks single text nodes, but the trend label splits "+20%"
// and "vs past month" across separate nodes. Match the element whose full textContent equals the
// sentence but whose children don't (otherwise both the wrapping element and its ancestors would match).
const hasTextContent = (text: string) => (_: string, element: Element | null) => {
  if (!element) return false;
  const nodeHasText = (node: Element) => node.textContent === text;

  return nodeHasText(element) && Array.from(element.children).every((child) => !nodeHasText(child));
};

const mockWeeks = (weeks: QuestionsByAnswered[]) =>
  vi.mocked(fetchStatistics).mockResolvedValue({
    range: ['2026-05-26', '2026-08-24'],
    questions_by_answered: weeks,
  } as Awaited<ReturnType<typeof fetchStatistics>>);

const mockTopUnanswered = (body: string) =>
  vi.mocked(fetchQuestionsRanking).mockResolvedValue({
    data: [{ id: 3, original_text: body, question_count: 12, centroid_message_id: 9, last_message_body: body }],
  } as Awaited<ReturnType<typeof fetchQuestionsRanking>>);

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <QuestionsWidget />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("QuestionsWidget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports this month’s unanswered rate against the month before it", async () => {
    // The four weeks before last were 20/80 unanswered, and the last four are 40/60
    mockWeeks([
      { date: '2026-06-22', answered: 20, unanswered: 5 },
      { date: '2026-06-29', answered: 20, unanswered: 5 },
      { date: '2026-07-06', answered: 20, unanswered: 5 },
      { date: '2026-07-13', answered: 20, unanswered: 5 },
      { date: '2026-07-20', answered: 15, unanswered: 10 },
      { date: '2026-07-27', answered: 15, unanswered: 10 },
      { date: '2026-08-03', answered: 15, unanswered: 10 },
      { date: '2026-08-10', answered: 15, unanswered: 10 },
    ]);
    mockTopUnanswered("Has Indonesia declared Work From Home?");

    renderComponent();

    expect(await screen.findByText("40%")).toBeInTheDocument();
    expect(screen.getByText("of questions unanswered this month")).toBeInTheDocument();
    expect(screen.getByText(hasTextContent("+20% vs past month"))).toBeInTheDocument();
    expect(await screen.findByText(/Has Indonesia declared Work From Home\?/)).toBeInTheDocument();
  });

  it("pools the month’s rate rather than averaging its weeks", async () => {
    // Averaging the weekly rates would read 50%; the busy week has to carry more weight
    mockWeeks([
      { date: '2026-08-03', answered: 0, unanswered: 1 },
      { date: '2026-08-10', answered: 90, unanswered: 10 },
    ]);
    mockTopUnanswered("Why is the sky blue?");

    renderComponent();

    expect(await screen.findByText("11%")).toBeInTheDocument();
  });

  it("explains the empty state when the audience asked nothing this month", async () => {
    mockWeeks([
      { date: '2026-08-03', answered: 0, unanswered: 0 },
      { date: '2026-08-10', answered: 0, unanswered: 0 },
    ]);

    renderComponent();

    expect(await screen.findByText("questions this month")).toBeInTheDocument();
    expect(screen.queryByText(/vs past month/)).not.toBeInTheDocument();
    expect(screen.getByText(/will be available when received from your audience/)).toBeInTheDocument();
  });

  it("shows no most-asked hint when every question this month was answered", async () => {
    mockWeeks([
      { date: '2026-08-03', answered: 8, unanswered: 0 },
      { date: '2026-08-10', answered: 8, unanswered: 0 },
    ]);

    renderComponent();

    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.queryByText(/Most common unanswered question/)).not.toBeInTheDocument();
    expect(fetchQuestionsRanking).not.toHaveBeenCalled();
  });
});
