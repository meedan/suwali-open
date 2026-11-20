import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { fetchContributions } from '@services/ContributionsService';

import { ToastProvider } from '@hooks/useToast';

import DataSourcesContributionsPanel from './DataSourcesContributionsPanel';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({
    currentHub: () => null,
    currentHubId: () => 1,
  }),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@hooks/useSignalEnabled', () => ({
  useSignalEnabled: () => false,
}));

vi.mock('@services/ContributionsService', () => ({
  fetchContributions: vi.fn(),
}));

vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn().mockResolvedValue({ data: [], pagination: {} }),
}));

vi.mock('@components/SortModal', () => ({
  SortModal: () => null,
}));

const emptyPage = {
  data: [],
  pagination: {
    current_page: 1,
    per_page: 20,
    total_pages: 0,
    total_count: 0,
    unfiltered_count: 0,
    next_page: null,
    prev_page: null,
    first_page: true,
    last_page: true,
  },
};

const renderPanel = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              <DataSourcesContributionsPanel />
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe('DataSourcesContributionsPanel loading', () => {
  beforeEach(() => {
    vi.mocked(fetchContributions).mockReset();
  });

  it('does not claim there are no contributions while they load', async () => {
    let resolve: (value: typeof emptyPage) => void = () => {};
    vi.mocked(fetchContributions).mockReturnValue(new Promise(r => { resolve = r; }));

    renderPanel();

    expect(screen.queryByText(/There are no end-user contributions/)).not.toBeInTheDocument();

    resolve(emptyPage);

    expect(await screen.findByText(/There are no end-user contributions/)).toBeInTheDocument();
  });
});
