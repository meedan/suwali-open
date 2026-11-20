import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import type { ExternalUser } from '@customTypes/external-user';

import UpdateTrustedUserStatus from './UpdateTrustedUserStatus';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('./ConfirmTrustedUserStatusModal', () => ({
  default: ({ action }: { action: string }) => <div data-testid="confirm-modal" data-action={action} />,
}));

const user: ExternalUser = {
  type: 'ExternalUser',
  id: 1,
  name: 'Alice',
  platform: 'whatsapp',
  external_id: '15550000000',
  trusted_user: true,
  last_conversation_id: null,
  first_message_at: '',
  last_message_at: '',
  messages_count: 0,
};

const renderComponent = (overrides: Partial<ExternalUser> = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <UpdateTrustedUserStatus user={{ ...user, ...overrides }} />
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('UpdateTrustedUserStatus', () => {
  it('renders the Update button', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('passes action="remove" to the modal when user is trusted', () => {
    renderComponent({ trusted_user: true });
    expect(screen.getByTestId('confirm-modal')).toHaveAttribute('data-action', 'remove');
  });

  it('passes action="add" to the modal when user is not trusted', () => {
    renderComponent({ trusted_user: false });
    expect(screen.getByTestId('confirm-modal')).toHaveAttribute('data-action', 'add');
  });
});
