import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { ToastProvider } from '@hooks/useToast';

import DeletedHubDetails from './DeletedHubDetails';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

vi.mock('@hooks/usePageTitle', () => ({ default: vi.fn() }));

vi.mock('react-router', async () => ({
  ...(await vi.importActual('react-router')),
  useParams: vi.fn().mockReturnValue({ hubId: '1' }),
}));

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              {node}
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

const mockData = {
  hub_id: 1,
  hub_name: 'Gone Hub',
  organization_name: 'Acme Org',
  plan_at_deletion: 'free',
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: '2026-03-01T12:30:00Z',
  activity: [],
};

describe('DeletedHubDetails', () => {
  it('renders only a loading state when data has not loaded', () => {
    vi.mocked(useQuery).mockReturnValue({ data: undefined, isPending: true, error: null, status: 'pending' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it('renders the hub name and a deleted indicator', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    expect(screen.getByRole('heading', { name: 'Gone Hub' })).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });

  it('renders the back link pointing to /platform-admin', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    const backLink = screen.getByRole('link', { name: /admin dashboard/i });
    expect(backLink).toHaveAttribute('href', '/platform-admin');
  });

  it('renders the overview summary fields', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    expect(screen.getByText('Acme Org')).toBeInTheDocument();
    expect(screen.getByText('free')).toBeInTheDocument();
  });

  it('renders the milestone progress and activity timeline from the same activity data', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        ...mockData,
        activity: [{ type: 'hub_created', at: '2026-01-01T00:00:00Z', actor_email: null, detail: null }],
      },
      isPending: false,
      error: null,
      status: 'success',
    } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    // "Hub created" appears twice: once in the milestone strip, once in the activity timeline row.
    expect(screen.getAllByText('Hub created').length).toBe(2);
    expect(screen.getByText('Activity timeline')).toBeInTheDocument();
  });

  it('shows an empty state in the activity timeline when there is no recorded activity', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<DeletedHubDetails />);

    expect(screen.getByText('No recorded activity for this hub')).toBeInTheDocument();
  });
});
