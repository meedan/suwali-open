import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import ChurnedHubsSection from './ChurnedHubsSection';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          {node}
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

const mockData = {
  churned_hubs: [
    {
      hub_id: 42,
      hub_name: 'Gone Hub',
      organization_name: 'Acme Org',
      plan_at_deletion: 'free',
      created_at: '2026-01-01T00:00:00Z',
      deleted_at: '2026-03-01T00:00:00Z',
    },
  ],
};

describe('ChurnedHubsSection', () => {
  it('renders the churned-hubs table with a link to the deleted-hub detail page', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<ChurnedHubsSection />);

    const link = screen.getByRole('link', { name: 'Gone Hub' });
    expect(link).toHaveAttribute('href', '/platform-admin/hubs/42/deleted');
    expect(screen.getByText('Acme Org')).toBeInTheDocument();
    expect(screen.getByText('free')).toBeInTheDocument();
  });

  it('shows an empty state when there are no churned hubs', () => {
    vi.mocked(useQuery).mockReturnValue({ data: { churned_hubs: [] }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<ChurnedHubsSection />);

    expect(screen.getByText('No hubs have churned')).toBeInTheDocument();
  });

  it('shows an empty state when data has not yet loaded', () => {
    vi.mocked(useQuery).mockReturnValue({ data: undefined, isPending: true, error: null, status: 'pending' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<ChurnedHubsSection />);

    expect(screen.getByText('No hubs have churned')).toBeInTheDocument();
  });
});
