import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { ToastProvider } from '@hooks/useToast';

import HubDetails from './HubDetails';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQueries: vi.fn(),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@hooks/usePageTitle', () => ({ default: vi.fn() }));

vi.mock('react-router', async () => ({
  ...(await vi.importActual('react-router')),
  useParams: vi.fn().mockReturnValue({ hubId: '1' }),
}));

const renderWithProviders = (node: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
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
};

const mockHub = {
  id: 1,
  name: 'Test Hub',
  organization_name: 'Test Org',
  plan: 'premium',
  trial_active: false,
  trial_expired: false,
  trial_ends_at: null,
  invite_code: 'ABC123',
  created_at: '2024-01-01T00:00:00Z',
  users_count: 5,
  active_external_users_count: 10,
  max_messages: null,
  sources_count: 3,
  max_sources: null,
  documents_count: 20,
  max_documents: null,
  document_errors_count: 0,
  unconfirmed_editors_count: 0,
  unapproved_editors_count: 0,
  custom_limits: null,
  whatsapp_phone: null,
  telegram_username: null,
  signal_phone: null,
  last_internal_conversation_at: '2024-06-15T10:30:00Z',
  last_external_conversation_at: null,
  last_document_added_at: null,
};

const pendingResult = { data: undefined, isPending: true, error: null, status: 'pending' } as UseQueryResult<unknown, unknown>;
const emptyMembershipsResult = { data: [], isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>;

describe('HubDetails', () => {
  it('renders only a loading state when hub data has not loaded', () => {
    vi.mocked(useQueries).mockReturnValue([pendingResult, emptyMembershipsResult, emptyMembershipsResult]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
  });

  it('shows a pink icon for null conversation timestamps on non-free plans', () => {
    vi.mocked(useQueries).mockReturnValue([
      {
        data: { ...mockHub, last_internal_conversation_at: null, last_external_conversation_at: null },
        isPending: false,
        error: null,
        status: 'success',
      } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    const lastInternalLabel = screen.getByText('Last internal conversation');
    const lastExternalLabel = screen.getByText('Last external conversation');

    expect(lastInternalLabel.closest('div')?.querySelector('dd')).not.toHaveTextContent('—');
    expect(lastInternalLabel.closest('div')?.querySelector('dd svg')).toBeInTheDocument();
    expect(lastExternalLabel.closest('div')?.querySelector('dd')).toHaveTextContent('—');
    expect(lastExternalLabel.closest('div')?.querySelector('dd svg')).toBeInTheDocument();
  });

  it('renders the back link pointing to /platform-admin', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: mockHub, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    const backLink = screen.getByRole('link', { name: /admin dashboard/i });
    expect(backLink).toHaveAttribute('href', '/platform-admin');
  });

  it('links to the message reports for this hub', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: mockHub, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('link', { name: 'Message reports' }))
      .toHaveAttribute('href', `/platform-admin/message-reports?hub_id=${mockHub.id}`);
  });

  it('links to the conversations export for this hub', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: mockHub, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('link', { name: 'Export hub conversations' }))
      .toHaveAttribute('href', `/platform-admin/export-hub-conversations?hub_id=${mockHub.id}`);
  });

  it('shows the hub ID as a copy button in the header', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: mockHub, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('button', { name: '#1' })).toBeInTheDocument();
  });

  it('always shows the edit plan button', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: mockHub, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('button', { name: /update plan/i })).toBeInTheDocument();
  });

  it('does not show custom limit edit buttons for non-enterprise plans', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'pro' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.queryByRole('button', { name: /update max monthly messages/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update max data sources/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update max documents/i })).not.toBeInTheDocument();
  });

  it('shows custom limit edit buttons for enterprise plan', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'enterprise' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('button', { name: /update max monthly messages/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update max data sources/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update max documents/i })).toBeInTheDocument();
  });

  it('shows the SMS toggle unchecked when SMS is not enabled', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'pro', custom_limits: null }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('checkbox', { name: /sms enabled/i })).not.toBeChecked();
  });

  it('shows the SMS toggle checked when SMS is enabled', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'standard', custom_limits: { sms: true } }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('checkbox', { name: /sms enabled/i })).toBeChecked();
  });

  it('hides the SMS toggle on plans that do not include SMS', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'subsidized', custom_limits: { sms: true } }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.queryByRole('checkbox', { name: /sms enabled/i })).not.toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('shows document errors count without a status icon when errors are zero', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, document_errors_count: 0 }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    const errorsLabel = screen.getByText('Documents with errors');
    const dd = errorsLabel.closest('div')?.querySelector('dd');
    expect(dd).toHaveTextContent('0');
    expect(dd?.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows document errors count with a pink status icon when errors are non-zero', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, document_errors_count: 3 }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    const errorsLabel = screen.getByText('Documents with errors');
    const dd = errorsLabel.closest('div')?.querySelector('dd');
    expect(dd).toHaveTextContent('3');
    expect(dd?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows the delete hub button for free plan hubs', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'free' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('button', { name: /delete hub/i })).toBeInTheDocument();
  });

  it('does not show the delete hub button for premium plan hubs', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'enterprise' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.queryByRole('button', { name: /delete hub/i })).not.toBeInTheDocument();
  });

  it('shows the deletion scheduled indicator instead of the delete button when deletion is requested', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, plan: 'free', deletion_requested_at: '2026-07-31T12:00:00Z' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByText('Deletion scheduled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete hub/i })).not.toBeInTheDocument();
  });

  it('does not show the trial end date edit button when trial_ends_at is null', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, trial_ends_at: null }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.queryByRole('button', { name: /update trial end date/i })).not.toBeInTheDocument();
  });

  it('shows the trial end date edit button when trial_ends_at is set', () => {
    vi.mocked(useQueries).mockReturnValue([
      { data: { ...mockHub, trial_ends_at: '2026-06-01T00:00:00Z' }, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>,
      emptyMembershipsResult,
      emptyMembershipsResult,
    ]);

    renderWithProviders(<HubDetails />);

    expect(screen.getByRole('button', { name: /update trial end date/i })).toBeInTheDocument();
  });
});
