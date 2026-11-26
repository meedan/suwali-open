import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToastProvider } from '@hooks/useToast';

import Dashboard from './Dashboard';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

vi.mock('@hooks/usePageTitle', () => ({ default: vi.fn() }));

vi.mock('@components/Can', () => ({ Can: () => null }));

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

const mockHub = {
  id: 42,
  name: 'Test Hub',
  organization_name: 'Test Org',
  plan: 'premium',
  trial_active: false,
  trial_expired: false,
  trial_ends_at: null,
  trial_emails_enabled: false,
  invite_code: 'ABC123',
  created_at: '2024-01-01T00:00:00Z',
  users_count: 5,
  unconfirmed_editors_count: 0,
  unapproved_editors_count: 0,
  active_external_users_count: 10,
  max_messages: null,
  sources_count: 3,
  document_errors_count: 0,
  max_sources: null,
  documents_count: 20,
  max_documents: null,
  last_document_added_at: new Date().toISOString(),
  last_internal_conversation_at: new Date().toISOString(),
  last_external_conversation_at: new Date().toISOString(),
  custom_limits: null,
  whatsapp_phone: null,
  telegram_username: null,
  signal_phone: null,
};

const emptyQuery = { data: [], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>;

describe('Dashboard', () => {
  it('links to the export hub conversations page', () => {
    vi.mocked(useQuery).mockReturnValue(emptyQuery);

    renderWithProviders(<Dashboard />);

    expect(screen.getByRole('link', { name: 'Export hub conversations' }))
      .toHaveAttribute('href', '/platform-admin/export-hub-conversations');
  });

  it('renders hub name as a link to the hub detail page', () => {
    vi.mocked(useQuery)
      .mockReturnValueOnce({ data: [mockHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>)
      .mockReturnValue(emptyQuery);

    renderWithProviders(<Dashboard />);

    const link = screen.getByRole('link', { name: 'Test Hub' });
    expect(link).toHaveAttribute('href', '/platform-admin/hubs/42');
  });

  it('shows the empty state for each attention list when there are no users', () => {
    vi.mocked(useQuery).mockReturnValue(emptyQuery);

    renderWithProviders(<Dashboard />);

    expect(screen.getAllByText('None')).toHaveLength(4);
  });

  it('renders status filter pills with counts', () => {
    vi.mocked(useQuery)
      .mockReturnValueOnce({ data: [mockHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>)
      .mockReturnValue(emptyQuery);

    renderWithProviders(<Dashboard />);

    expect(screen.getByRole('radio', { name: /all \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /all good/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /worth checking/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /look into this/i })).toBeInTheDocument();
  });

  it('filters hubs by "look into this" status and shows empty state when none match', () => {
    vi.mocked(useQuery)
      .mockReturnValueOnce({ data: [mockHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>)
      .mockReturnValue(emptyQuery);

    renderWithProviders(<Dashboard />);

    fireEvent.click(screen.getByRole('radio', { name: /look into this/i }));

    expect(screen.queryByRole('link', { name: 'Test Hub' })).not.toBeInTheDocument();
    expect(screen.getByText('No hubs match this filter')).toBeInTheDocument();
  });

  it('restores all hubs when clicking the All pill after filtering by status', () => {
    vi.mocked(useQuery).mockImplementation((options) => {
      if ((options.queryKey as string[])[0] === '/admin/hubs') {
        return { data: [mockHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>;
      }
      return emptyQuery;
    });

    renderWithProviders(<Dashboard />);

    fireEvent.click(screen.getByRole('radio', { name: /look into this/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^all \(/i }));

    expect(screen.getByRole('link', { name: 'Test Hub' })).toBeInTheDocument();
  });

  it('filters hubs by search term matching name or organization', () => {
    const otherHub = { ...mockHub, id: 55, name: 'Acme Hub', organization_name: 'Acme Corp' };

    vi.mocked(useQuery).mockImplementation((options) => {
      if ((options.queryKey as string[])[0] === '/admin/hubs') {
        return { data: [mockHub, otherHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>;
      }
      return emptyQuery;
    });

    renderWithProviders(<Dashboard />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find hubs' }), { target: { value: 'acme' } });

    expect(screen.queryByRole('link', { name: 'Test Hub' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Hub' })).toBeInTheDocument();
  });

  it('composes search with status pill filter', () => {
    // Acme Green: matches 'acme' search AND 'all good' status filter — should be visible
    const acmeGreenHub = { ...mockHub, id: 77, name: 'Acme Hub', organization_name: 'Acme Corp' };
    // Acme Pink: matches 'acme' search but NOT 'all good' — excluded by status filter
    const acmePinkHub = { ...mockHub, id: 88, name: 'Acme Pink', organization_name: 'Acme Corp', sources_count: 0 };

    vi.mocked(useQuery).mockImplementation((options) => {
      if ((options.queryKey as string[])[0] === '/admin/hubs') {
        return { data: [mockHub, acmeGreenHub, acmePinkHub], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>;
      }
      return emptyQuery;
    });

    renderWithProviders(<Dashboard />);

    fireEvent.click(screen.getByRole('radio', { name: /all good/i }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find hubs' }), { target: { value: 'acme' } });

    expect(screen.queryByRole('link', { name: 'Acme Pink' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Hub' })).toBeInTheDocument();
  });

  it('uses a stable composite key for attention users with the same email across hubs', () => {
    const sameUserTwoHubs = [
      { email: 'shared@example.com', hub_name: 'Hub A', created_at: '2024-01-01T00:00:00Z', requested_at: '2024-02-01T00:00:00Z' },
      { email: 'shared@example.com', hub_name: 'Hub B', created_at: '2024-01-01T00:00:00Z', requested_at: '2024-03-01T00:00:00Z' },
    ];

    vi.mocked(useQuery)
      .mockReturnValueOnce(emptyQuery) // hubs
      .mockReturnValueOnce(emptyQuery) // unconfirmedUsers
      .mockReturnValueOnce(emptyQuery) // usersWithNoHub
      .mockReturnValueOnce({ data: sameUserTwoHubs, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>) // usersPendingApproval
      .mockReturnValue(emptyQuery); // inactiveUsers

    renderWithProviders(<Dashboard />);

    expect(screen.getAllByText('shared@example.com')).toHaveLength(2);
    expect(screen.getByText('Hub A')).toBeInTheDocument();
    expect(screen.getByText('Hub B')).toBeInTheDocument();
  });

  it('lists inactive editors and describes the cutoff the API reported', () => {
    vi.mocked(useQuery).mockImplementation((options) => {
      if ((options.queryKey as string[])[0] === '/admin/users/inactive') {
        return {
          data: {
            threshold_days: 30,
            users: [{ id: 9, email: 'dormant@example.com', hub_name: 'Quiet Hub', hub_id: 3, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: '2024-02-01T00:00:00Z' }],
          },
          isPending: false,
          error: null,
          status: 'success',
        } as UseQueryResult<unknown, unknown>;
      }
      return emptyQuery;
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText('Editors who have not used Suwali in the past 30 days')).toBeInTheDocument();
    expect(screen.getByText('dormant@example.com')).toBeInTheDocument();
  });
});
