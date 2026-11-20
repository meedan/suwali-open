import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { updatePassword } from '@services/AuthService';
import { fetchMe } from '@services/ProfileService';

import { HttpError } from '@root/NetworkLayer';

import { ToastProvider } from '@hooks/useToast';

import Account from './Account';

vi.mock('@services/AuthService', () => ({
  updatePassword: vi.fn(),
}));

vi.mock('@services/ProfileService', () => ({
  fetchMe: vi.fn(),
}));

const user = {
  last_login_at: '2026-03-04T09:30:00Z',
  last_active_at: '2026-03-06T17:45:00Z',
};

const renderAccount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlProvider locale="en" messages={{}}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <Account />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );

const openChangePasswordSection = () => {
  fireEvent.click(screen.getByText(/change password/i));
  return screen.getByText(/change password/i).closest('details') as HTMLDetailsElement;
};

const fillValidForm = () => {
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'OldPass1!' } });
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'NewPass1!' } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'NewPass1!' } });
};

describe('Account', () => {
  beforeEach(() => {
    vi.mocked(updatePassword).mockClear();
    vi.mocked(fetchMe).mockResolvedValue(user as never);
  });

  // Formatted the same way the component does, so this holds in any timezone.
  const formatted = (iso: string) =>
    new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

  it('shows when the user last logged in and was last active', async () => {
    renderAccount();

    expect(await screen.findByText(formatted(user.last_login_at))).toBeInTheDocument();
    expect(screen.getByText(formatted(user.last_active_at))).toBeInTheDocument();
  });

  it('says the timestamps were not recorded, rather than that they never happened', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ last_login_at: null, last_active_at: null } as never);

    renderAccount();

    expect(await screen.findAllByText('Not recorded yet')).toHaveLength(2);
  });

  it('toggles all three password fields between hidden and visible text when "Show password" is checked', () => {
    renderAccount();
    openChangePasswordSection();

    const currentPasswordInput = screen.getByLabelText(/current password/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);

    expect(currentPasswordInput).toHaveAttribute('type', 'password');
    expect(newPasswordInput).toHaveAttribute('type', 'password');
    expect(confirmPasswordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('checkbox', { name: /show password/i }));

    expect(currentPasswordInput).toHaveAttribute('type', 'text');
    expect(newPasswordInput).toHaveAttribute('type', 'text');
    expect(confirmPasswordInput).toHaveAttribute('type', 'text');
  });

  it('updates the password, toasts success, clears the fields, and collapses the section', async () => {
    vi.mocked(updatePassword).mockResolvedValueOnce({ message: 'ok' });
    renderAccount();
    const details = openChangePasswordSection();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password updated successfully/i)).toBeInTheDocument();
    });

    expect(updatePassword).toHaveBeenCalledWith('OldPass1!', 'NewPass1!');
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
    expect(details.open).toBe(false);
  });

  it('shows the server error and keeps the section open when the current password is wrong', async () => {
    // The component logs the failure via console.error before setting the
    // error state; the global test setup makes console.error throw, so it
    // needs a local no-op override to reach that state update.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updatePassword).mockRejectedValueOnce(
      new HttpError(422, { errors: ['Current password is invalid'] }, new Headers())
    );
    renderAccount();
    const details = openChangePasswordSection();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/current password is invalid/i)).toBeInTheDocument();
    });

    expect(details.open).toBe(true);
  });

  it('ignores repeat clicks while the update is in flight, disabling both buttons', async () => {
    let resolveUpdate: (value: { message: string }) => void = () => {};
    vi.mocked(updatePassword).mockReturnValueOnce(
      new Promise(resolve => {
        resolveUpdate = resolve;
      })
    );
    renderAccount();
    openChangePasswordSection();
    fillValidForm();

    const updateButton = screen.getByRole('button', { name: /update password/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    fireEvent.click(updateButton);
    fireEvent.click(updateButton);
    fireEvent.click(updateButton);

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updateButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    resolveUpdate({ message: 'ok' });
    await waitFor(() => {
      expect(screen.getByText(/password updated successfully/i)).toBeInTheDocument();
    });
  });

  it('clears the fields and collapses the section on cancel without calling the API', () => {
    renderAccount();
    const details = openChangePasswordSection();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
    expect(details.open).toBe(false);
  });
});
