import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import type { Hub } from '@customTypes/hub';

import type { About } from '@services/AboutService';
import * as AboutService from '@services/AboutService';

import * as SessionContext from '@root/SessionContext';
import { buildHub } from '@root/test/fixtures/hub';

import Plans from './Plans';

vi.mock('@services/AboutService');
vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));
vi.mock('@components/Hub', () => ({
  default: () => <div data-testid="hub" />
}));

const about = {
  plans: {
    trial: { messages: 1000, sources: 3, documents: 100 },
    subsidized: { messages: 1000, sources: 5, documents: 500 },
    standard: { messages: 2000, sources: 5, documents: 500 },
    pro: { messages: 7500, sources: 10, documents: 1000 },
    enterprise: { messages: null, sources: null, documents: null },
  },
  schedule_demo_link: 'https://example.com/demo',
} as unknown as About;

const testHub = buildHub({
  plan: 'pro',
  trial_active: false,
  restricted: false,
  external_data_sources_count: 3,
  documents_count: 10,
  monthly_messages_count: 900,
  max_sources_for_plan: 10,
  max_documents_for_plan: 1000,
  max_messages_for_plan: 7500,
});

const mockHub = (hub: Hub) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHub: () => hub,
    currentHubId: () => hub.id,
  } as ReturnType<typeof SessionContext.useSession>);
};

// Limits are the <dd> cells of each tier; a tier's price label can read "Custom" too
const findLimitsReading = async (text: string) =>
  (await screen.findAllByRole('definition')).filter(limit => limit.textContent === text);

const renderComponent = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <Plans />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe('Plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AboutService.fetchAbout).mockResolvedValue(about);
  });

  it('shows the enterprise hub’s own limits in the Enterprise tier', async () => {
    mockHub({ ...testHub, plan: 'enterprise', max_messages_for_plan: 20000, max_sources_for_plan: 42, max_documents_for_plan: 8000 });

    renderComponent();

    expect(await screen.findByText('up to 20,000')).toBeInTheDocument();
    expect(screen.getByText('up to 42')).toBeInTheDocument();
    expect(screen.getByText('up to 8,000')).toBeInTheDocument();
  });

  it('shows Unrestricted in the Enterprise tier for an enterprise hub without custom limits', async () => {
    mockHub({ ...testHub, plan: 'enterprise', max_messages_for_plan: null, max_sources_for_plan: null, max_documents_for_plan: null });

    renderComponent();

    expect(await findLimitsReading('Unrestricted')).toHaveLength(3);
  });

  it('shows Custom in the Enterprise tier for a non-enterprise hub', async () => {
    mockHub(testHub);

    renderComponent();

    expect(await findLimitsReading('Custom')).toHaveLength(3);
  });

  it('sends people to book a demo, at the link the server gives, to contact sales about another plan', async () => {
    mockHub(testHub);

    renderComponent();

    const links = await screen.findAllByRole('link', { name: 'Contact sales' });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://example.com/demo');
    }
  });
});
