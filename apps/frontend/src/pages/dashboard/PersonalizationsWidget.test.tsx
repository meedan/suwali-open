import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { fetchExternalResources } from "@services/ExternalResourcesService";

import * as SessionContext from "@root/SessionContext";

import PersonalizationsWidget from "./PersonalizationsWidget";

vi.mock("@root/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("@services/ExternalResourcesService", () => ({
  fetchExternalResources: vi.fn(),
}));

const mockHub = (botAttributes?: Record<string, unknown>) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHub: () => ({ id: 1, bot_attributes: botAttributes }),
    currentHubId: () => 1,
  } as ReturnType<typeof SessionContext.useSession>);
};

const renderComponent = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <PersonalizationsWidget />
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("PersonalizationsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchExternalResources).mockResolvedValue([]);
  });

  it("renders the chatbot name, description and personalization hint", async () => {
    mockHub({
      name: "Evidence Bot",
      description: "A chatbot for checking claims.",
      tone: "journalist",
      supported_languages: ["English", "Spanish"],
    });

    renderComponent();

    expect(screen.getByText("Evidence Bot")).toBeInTheDocument();
    expect(screen.getByText("A chatbot for checking claims.")).toBeInTheDocument();
    expect(await screen.findByText(/Journalist tone/)).toBeInTheDocument();
    expect(screen.getByText("2 languages")).toBeInTheDocument();
  });

  it("asks for both a name and description when both are missing", () => {
    mockHub();

    renderComponent();

    expect(screen.getByText(/Give your chatbot a name and describe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Give your chatbot a name/ })).toHaveAttribute("href", "/hub/1/personalization/name");
  });

  it("asks for a description when the chatbot has a name but no description", () => {
    mockHub({ name: "Evidence Bot" });

    renderComponent();

    expect(screen.getByText("Evidence Bot")).toBeInTheDocument();
    expect(screen.getByText(/Describe the best use of your chatbot/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Describe the best use/ })).toHaveAttribute("href", "/hub/1/personalization/role");
  });
});
