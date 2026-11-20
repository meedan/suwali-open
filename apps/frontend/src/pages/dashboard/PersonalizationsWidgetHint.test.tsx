import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PersonalizationsWidgetHint from "./PersonalizationsWidgetHint";

const renderComponent = (props: React.ComponentProps<typeof PersonalizationsWidgetHint>) =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <PersonalizationsWidgetHint {...props} />
      </IntlProvider>
    </MemoryRouter>
  );

const hasTextContent = (text: string) => (_: string, element: Element | null) => {
  if (!element) return false;
  return element.textContent === text && Array.from(element.children).every(
    child => child.textContent !== text
  );
};

describe("PersonalizationsWidgetHint", () => {
  it("renders the combined hint and scenario count for all personalization data", () => {
    renderComponent({
      tone: "journalist",
      languages: ["English", "Spanish"],
      resources: [
        { id: 1, title: "Claims", scenarios: ["first_message", "unanswerable_question"] },
        { id: 2, title: "Help", scenarios: ["speak_to_person"] },
      ],
    });

    expect(screen.getByText(hasTextContent("The Journalist tone of your chatbot will respond in 2 languages using 2 resources covering 3 scenarios."))).toBeInTheDocument();
    expect(screen.getByText("2 languages")).toBeInTheDocument();
    expect(screen.getByText("2 resources")).toBeInTheDocument();
    expect(screen.getByText("3 scenarios")).toBeInTheDocument();
  });

  it("renders the external resources fallback when no personalization data exists", () => {
    renderComponent({});

    expect(screen.getByText(/Point your chatbot to resources/)).toBeInTheDocument();
  });

  it("describes the default tone while none is chosen and there are languages", () => {
    renderComponent({ languages: ["en"] });

    expect(screen.getByText(hasTextContent("The Journalist tone of your chatbot will respond in 1 language."))).toBeInTheDocument();
  });

  it("says all languages while none are chosen, and does not mention resources when there are none", () => {
    renderComponent({ tone: "advocate" });

    expect(screen.getByText(hasTextContent("The Advocate tone of your chatbot will respond in all languages."))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "all languages" })).toHaveAttribute("href", "/personalization/languages");
    expect(screen.queryByText(/resources/)).not.toBeInTheDocument();
  });

  it("describes the default tone and all languages when only resources are set", () => {
    renderComponent({ resources: [{ id: 1, title: "Claims", scenarios: ["first_message"] }] });

    expect(screen.getByText(hasTextContent("The Journalist tone of your chatbot will respond in all languages using 1 resource covering 1 scenario."))).toBeInTheDocument();
  });

  it("links each part of the hint to its personalization section", () => {
    renderComponent({
      tone: "journalist",
      languages: ["English", "Spanish"],
      resources: [{ id: 1, title: "Claims", scenarios: ["first_message"] }],
    });

    expect(screen.getByRole("link", { name: "Journalist tone" })).toHaveAttribute("href", "/personalization/tone");
    expect(screen.getByRole("link", { name: "2 languages" })).toHaveAttribute("href", "/personalization/languages");
    expect(screen.getByRole("link", { name: "1 resource" })).toHaveAttribute("href", "/personalization/resources");
    expect(screen.getByRole("link", { name: "1 scenario" })).toHaveAttribute("href", "/personalization/resources");
  });
});
