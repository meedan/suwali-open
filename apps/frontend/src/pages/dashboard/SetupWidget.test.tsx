import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { useHubSetupTasks } from "@hooks/useHubSetupTasks";
import { ToastProvider } from "@hooks/useToast";

import SetupWidget from "./SetupWidget";

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQuery: vi.fn(),
}));

vi.mock("@hooks/useCapabilities", () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock("@hooks/useHubSetupTasks", () => ({
  useHubSetupTasks: vi.fn(),
}));

const setIntegrations = (integrations: unknown[]) => {
  vi.mocked(useQuery).mockReturnValue({
    data: integrations,
    isPending: false,
    error: null,
    status: 'success',
  } as UseQueryResult<unknown, unknown>);
};

const setContentAdded = (contentAdded: boolean) => {
  vi.mocked(useHubSetupTasks).mockReturnValue({
    ownSourceCreated: contentAdded,
    ownDocumentSynced: contentAdded,
    isPending: false,
  } as ReturnType<typeof useHubSetupTasks>);
};

const renderWithProviders = (onHide?: () => void) => {
  return render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <ToastProvider>
          <SetupWidget onHide={onHide} />
        </ToastProvider>
      </IntlProvider>
    </MemoryRouter>
  );
};

describe("SetupWidget", () => {
  beforeEach(() => {
    setContentAdded(true);
    setIntegrations([]);
  });

  it("Should prompt to resume setup when the hub has no content yet", () => {
    setContentAdded(false);
    setIntegrations([{ id: 1, platform: "whatsapp", active: true, phone_number: "+557199999999" }]);

    renderWithProviders(vi.fn());

    expect(screen.getByText("Continue setup")).toBeInTheDocument();
    expect(screen.queryByText("+557199999999")).not.toBeInTheDocument();
    // Setup isn't done yet, so there is nothing to hide
    expect(screen.queryByTitle("Hide this widget")).not.toBeInTheDocument();
  });

  it("Should prompt to connect a platform when the hub has content but no integration", () => {
    renderWithProviders(vi.fn());

    expect(screen.getByText("Go live!")).toBeInTheDocument();
    expect(screen.getByText("Connect a platform")).toBeInTheDocument();
    // Setup isn't done yet, so there is nothing to hide
    expect(screen.queryByTitle("Hide this widget")).not.toBeInTheDocument();
  });

  it("Should render all integrations correctly when data is complete (happy path)", () => {
    setIntegrations([
      { id: 1, platform: "telegram", active: true, bot_name: "My Bot", bot_username: "my_bot" },
      { id: 2, platform: "whatsapp", active: true, phone_number: "+557199999999" }
    ]);

    renderWithProviders();

    expect(screen.getByText("My Bot")).toBeInTheDocument();
    expect(screen.getByText("https://t.me/my_bot")).toBeInTheDocument();

    expect(screen.getByText("+557199999999")).toBeInTheDocument();
    expect(screen.getByText("https://wa.me/557199999999")).toBeInTheDocument();

    expect(screen.getByText("Messaging integrations")).toBeInTheDocument();
  });

  it("Can be hidden once setup is fully connected", () => {
    setIntegrations([
      { id: 1, platform: "whatsapp", active: true, phone_number: "+557199999999" }
    ]);
    const onHide = vi.fn();

    renderWithProviders(onHide);

    fireEvent.click(screen.getByTitle("Hide this widget"));

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("Should not crash when telegram bot_username is missing", () => {
    setIntegrations([
      { id: 1, platform: "telegram", active: true, bot_name: "Test Bot" },
      { id: 2, platform: "whatsapp", active: true, phone_number: "12345" }
    ]);

    renderWithProviders();

    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.queryByText(/t.me/)).not.toBeInTheDocument();
  });
});
