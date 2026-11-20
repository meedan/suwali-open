import { Tooltip as TooltipPrimitive } from "radix-ui";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { fetchQuestionsRanking, fetchStatistics } from "@services/HubService";

import { ToastProvider } from "@hooks/useToast";

import QuestionsChart from "./QuestionsChart";

vi.mock("@services/HubService", () => ({
  fetchQuestionsRanking: vi.fn(),
  fetchStatistics: vi.fn(),
}));

vi.mock("@root/SessionContext", () => ({
  useSession: () => ({
    currentHubId: () => 1,
  }),
}));

vi.mock("@hooks/useCapabilities", () => ({
  useCan: () => ({ allowed: true }),
}));

// happy-dom reports a zero-sized container, which makes recharts throw
vi.mock("recharts", () => ({
  Bar: () => null,
  CartesianGrid: () => null,
  ComposedChart: () => null,
  Legend: () => null,
  Line: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <IntlProvider locale="en" messages={{}}>
            <TooltipPrimitive.Provider>
              <QuestionsChart />
            </TooltipPrimitive.Provider>
          </IntlProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("QuestionsChart", () => {
  it("lists the month’s unanswered questions with how often each was asked", async () => {
    vi.mocked(fetchStatistics).mockResolvedValue({
      range: ['2026-05-26', '2026-08-24'],
      questions_by_answered: [{ date: '2026-08-17', answered: 40, unanswered: 20 }],
    } as Awaited<ReturnType<typeof fetchStatistics>>);
    vi.mocked(fetchQuestionsRanking).mockResolvedValue({
      data: [{ id: 1, original_text: "Who is the CEO of Meedan?", question_count: 1285, centroid_message_id: 1, last_message_body: "Who is the CEO of Meedan?" }],
    } as Awaited<ReturnType<typeof fetchQuestionsRanking>>);

    renderComponent();

    expect(await screen.findByText("Who is the CEO of Meedan?")).toBeInTheDocument();
    expect(screen.getByText("1,285")).toBeInTheDocument();
  });
});
