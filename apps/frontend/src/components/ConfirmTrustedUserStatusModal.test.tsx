import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ExternalUser } from '@customTypes/external-user';

import { ToastProvider } from '@hooks/useToast';

import ConfirmTrustedUserStatusModal from './ConfirmTrustedUserStatusModal';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@services/ExternalUsersService', () => ({
  updateExternalUserTrustedStatus: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body }: { title: React.ReactNode; body: React.ReactNode }) => (
    <dialog open>
      <div>{title}</div>
      <div>{body}</div>
    </dialog>
  ),
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

const renderModal = (action: 'add' | 'remove') =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ToastProvider>
        <ConfirmTrustedUserStatusModal
          action={action}
          open={true}
          user={user}
          onOpenChange={vi.fn()}
        />
      </ToastProvider>
    </IntlProvider>
  );

describe('ConfirmTrustedUserStatusModal', () => {
  it('renders the add title when action is add', () => {
    renderModal('add');
    expect(screen.getByText('Add trusted end-user status?')).toBeInTheDocument();
  });

  it('renders the remove title when action is remove', () => {
    renderModal('remove');
    expect(screen.getByText('Remove trusted end-user status?')).toBeInTheDocument();
  });

  it('renders the user name in the body', () => {
    renderModal('remove');
    expect(screen.getByRole('dialog')).toHaveTextContent('Alice');
  });
});
