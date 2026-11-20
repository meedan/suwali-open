import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import * as AdminService from '@services/AdminService';

import { ToastProvider } from '@hooks/useToast';

import DeleteUserModal from './DeleteUserModal';

vi.mock('@services/AdminService', () => ({
  deleteUser: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, titleContext, body, actions }: { title: React.ReactNode; titleContext: React.ReactNode; body: React.ReactNode; actions: React.ReactNode }) => (
    <dialog open>
      <div>{title}</div>
      <div>{titleContext}</div>
      <div>{body}</div>
      <div>{actions}</div>
    </dialog>
  ),
}));

vi.mock('@ui-components/layout/Toast', () => ({
  Toast: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@ui-components/layout/Icon', () => ({
  default: () => null,
}));

const renderModal = (props: Partial<React.ComponentProps<typeof DeleteUserModal>> = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ToastProvider>
          <DeleteUserModal
            user={{ id: 42, email: 'test@example.com' }}
            invalidateQueryKey={['/admin/users/unconfirmed']}
            open
            onOpenChange={vi.fn()}
            {...props}
          />
        </ToastProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('DeleteUserModal', () => {
  it('renders the modal title', () => {
    renderModal();
    expect(screen.getByText('Delete user?')).toBeInTheDocument();
  });

  it('renders the user email in the title context', () => {
    renderModal();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('renders Cancel and confirm buttons', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete user' })).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls deleteUser with the correct userId when confirm is clicked', () => {
    vi.mocked(AdminService.deleteUser).mockResolvedValue(undefined);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete user' }));
    expect(AdminService.deleteUser).toHaveBeenCalledWith(42);
  });
});
