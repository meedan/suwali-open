import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

import { dateFormatOptions } from '@helpers/platform-admin';

import { ToastProvider } from '@hooks/useToast';

import AttentionList from './AttentionList';

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            {node}
          </ToastProvider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

const baseProps = {
  iconId: 'error_filled',
  title: 'Test List',
  description: 'Test description',
  showHub: true,
};

describe('AttentionList', () => {
  it('shows the empty state when users is undefined', () => {
    renderWithProviders(<AttentionList {...baseProps} users={undefined} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('shows the empty state when users is an empty array', () => {
    renderWithProviders(<AttentionList {...baseProps} users={[]} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders a link to the hub when hub_id is present', () => {
    const users = [{ id: 1, email: 'a@example.com', hub_name: 'My Hub', hub_id: 7, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null }];
    renderWithProviders(<AttentionList {...baseProps} users={users} />);
    const link = screen.getByRole('link', { name: 'My Hub' });
    expect(link).toHaveAttribute('href', '/platform-admin/hubs/7');
  });

  it('renders the hub name as plain text when hub_id is null', () => {
    const users = [{ id: 2, email: 'a@example.com', hub_name: 'Orphan Hub', hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null }];
    renderWithProviders(<AttentionList {...baseProps} users={users} />);
    expect(screen.getByText('Orphan Hub')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orphan Hub' })).not.toBeInTheDocument();
  });

  it('hides the hub column when showHub is false', () => {
    const users = [{ id: 3, email: 'a@example.com', hub_name: 'Hidden Hub', hub_id: 1, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null }];
    renderWithProviders(<AttentionList {...baseProps} showHub={false} users={users} />);
    expect(screen.queryByText('Hidden Hub')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Hub' })).not.toBeInTheDocument();
  });

  it('does not show the Delete column when deleteAction is not set', () => {
    const users = [{ id: 1, email: 'a@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null }];
    renderWithProviders(<AttentionList {...baseProps} users={users} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows the Delete button for each user when deleteAction is set', () => {
    const users = [
      { id: 1, email: 'a@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null },
      { id: 2, email: 'b@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null },
    ];
    renderWithProviders(<AttentionList {...baseProps} users={users} deleteAction={{ invalidateQueryKey: ['/admin/users/unconfirmed'] }} />);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('shows the last login and last active dates, falling back to a dash when there are none', () => {
    // Formatted the same way the component does, so this holds in any timezone.
    const formatted = (iso: string) => new Intl.DateTimeFormat('en', dateFormatOptions).format(new Date(iso));
    const users = [
      { id: 7, email: 'active@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: '2024-05-02T12:00:00Z', last_active_at: '2024-05-09T12:00:00Z' },
      { id: 8, email: 'never@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null },
    ];
    renderWithProviders(<AttentionList {...baseProps} showHub={false} users={users} />);

    expect(screen.getByRole('columnheader', { name: 'Last sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last active' })).toBeInTheDocument();
    expect(screen.getByText(formatted('2024-05-02T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText(formatted('2024-05-09T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows the Requested column only when at least one user has a requested_at date', () => {
    const usersWithout = [{ id: 4, email: 'a@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null }];
    const { unmount } = renderWithProviders(<AttentionList {...baseProps} users={usersWithout} />);
    expect(screen.queryByRole('columnheader', { name: 'Requested' })).not.toBeInTheDocument();
    unmount();

    const usersWithOne = [
      { id: 5, email: 'a@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: null, last_login_at: null, last_active_at: null },
      { id: 6, email: 'b@example.com', hub_name: null, hub_id: null, created_at: '2024-01-01T00:00:00Z', requested_at: '2024-06-01T00:00:00Z', last_login_at: null, last_active_at: null },
    ];
    renderWithProviders(<AttentionList {...baseProps} users={usersWithOne} />);
    expect(screen.getByRole('columnheader', { name: 'Requested' })).toBeInTheDocument();
  });
});
