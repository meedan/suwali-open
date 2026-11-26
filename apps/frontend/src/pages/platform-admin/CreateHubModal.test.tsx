import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AdminHubDetail } from '@services/AdminService';
import * as AdminService from '@services/AdminService';

import { useSession } from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import CreateHubModal from './CreateHubModal';

vi.mock('@services/AdminService', () => ({
  createAdminHub: vi.fn(),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode }) => (
    <dialog open>
      <div>{title}</div>
      <div>{body}</div>
      <div>{actions}</div>
    </dialog>
  ),
}));

vi.mock('@ui-components/layout/Toast', () => ({
  ToastNotification: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@ui-components/layout/Icon', () => ({
  default: () => null,
}));

const setCurrentHubId = vi.fn();

const renderModal = (onOpenChange = vi.fn()) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/platform-admin']}>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            <Routes>
              <Route path="/platform-admin" element={<CreateHubModal open onOpenChange={onOpenChange} />} />
              <Route path="/hub/:hubId/dashboard" element={<p>Hub dashboard</p>} />
            </Routes>
          </ToastProvider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('CreateHubModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentHubId.mockResolvedValue(undefined);
    vi.mocked(useSession).mockReturnValue({ setCurrentHubId } as unknown as ReturnType<typeof useSession>);
  });

  it('creates the hub on the free plan by default and opens it', async () => {
    vi.mocked(AdminService.createAdminHub).mockResolvedValue({ id: 7 } as AdminHubDetail);
    const onOpenChange = vi.fn();
    renderModal(onOpenChange);

    fireEvent.change(screen.getByLabelText(/Hub name/), { target: { value: '  Acme  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create hub' }));

    expect(await screen.findByText('Hub dashboard')).toBeInTheDocument();
    expect(AdminService.createAdminHub).toHaveBeenCalledWith({ name: 'Acme', plan: 'free' });
    expect(setCurrentHubId).toHaveBeenCalledWith(7);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('explains that trial emails start turned off on the default free plan', () => {
    renderModal();

    expect(screen.getByText(/Trial emails are turned off for this hub/)).toBeInTheDocument();
  });

  it('shows an error and does not call the API when the name is empty', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Create hub' }));

    expect(screen.getByText('Enter a name for the hub.')).toBeInTheDocument();
    expect(AdminService.createAdminHub).not.toHaveBeenCalled();
  });

  it('shows an error toast and stays on the page when creation fails', async () => {
    vi.mocked(AdminService.createAdminHub).mockRejectedValue(new Error('boom'));
    renderModal();

    fireEvent.change(screen.getByLabelText(/Hub name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create hub' }));

    expect(await screen.findByText('We couldn’t create the hub. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create hub' })).not.toBeDisabled());
    expect(setCurrentHubId).not.toHaveBeenCalled();
  });
});
