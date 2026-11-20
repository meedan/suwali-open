import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import * as AdminService from '@services/AdminService';

import { ToastProvider } from '@hooks/useToast';

import DeleteHubModal from './DeleteHubModal';

vi.mock('@services/AdminService', () => ({
  deleteAdminHub: vi.fn(),
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

const renderModal = (props: Partial<React.ComponentProps<typeof DeleteHubModal>> = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            <DeleteHubModal
              hubId={42}
              hubName="Test Hub"
              open
              onOpenChange={vi.fn()}
              {...props}
            />
          </ToastProvider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('DeleteHubModal', () => {
  it('renders the modal title', () => {
    renderModal();
    expect(screen.getByText('Delete hub?')).toBeInTheDocument();
  });

  it('renders the hub name in the title context', () => {
    renderModal();
    expect(screen.getByText('Test Hub')).toBeInTheDocument();
  });

  it('renders Cancel and confirm buttons', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete hub' })).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls deleteAdminHub with the correct hubId when confirm is clicked', () => {
    vi.mocked(AdminService.deleteAdminHub).mockResolvedValue(undefined);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete hub' }));
    expect(AdminService.deleteAdminHub).toHaveBeenCalledWith(42);
  });
});
