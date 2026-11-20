import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createExternalUser } from '@services/ExternalUsersService';

import { ToastProvider } from '@hooks/useToast';

import AddTrustedEndUserModal from './AddTrustedEndUserModal';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1, currentHub: () => undefined }),
}));

vi.mock('@services/ExternalUsersService', () => ({
  createExternalUser: vi.fn(),
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


vi.mock('@ui-components/input/SelectInput', () => ({
  Select: ({ children, label, value, triggerContent, 'aria-label': ariaLabel, onValueChange }: { children: React.ReactNode; label?: React.ReactNode; value?: string; triggerContent?: React.ReactNode; 'aria-label'?: string; onValueChange?: (value: string) => void }) => (
    <label>
      {label}
      <select aria-label={ariaLabel} value={value} onChange={e => onValueChange?.(e.target.value)}>
        {children}
      </select>
      <span>{triggerContent}</span>
    </label>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

// The country list has its own tests; here it only needs to say which country was chosen
vi.mock('@ui-components/input/CountrySelect', () => {
  const shown: Record<string, string> = { BR: '🇧🇷 +55', FR: '🇫🇷 +33', US: '🇺🇸 +1' };
  return {
    CountrySelect: ({ value, onValueChange }: { value: string; onValueChange: (country: string) => void }) => (
      <>
        <select aria-label="Country" value={value} onChange={e => onValueChange(e.target.value)}>
          {Object.keys(shown).map(code => <option key={code} value={code}>{code}</option>)}
        </select>
        <span>{shown[value]}</span>
      </>
    ),
  };
});

const renderModal = (open = true) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <AddTrustedEndUserModal open={open} onOpenChange={vi.fn()} />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('AddTrustedEndUserModal', () => {
  it('renders the modal title', () => {
    renderModal();
    expect(screen.getByText('Add trusted end-user status?')).toBeInTheDocument();
  });

  it('renders the platform options', () => {
    renderModal();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
  });

  it('renders the Cancel button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders the confirm button disabled when no platform is selected', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Add trusted status' })).toBeDisabled();
  });

  it('shows a country select for WhatsApp, prefixes its dial code onto the phone number, and submits it without a leading +', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'whatsapp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'BR' } });
    expect(screen.getByText('🇧🇷 +55')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '11987654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted status' }));

    await waitFor(() => {
      expect(vi.mocked(createExternalUser)).toHaveBeenCalledWith(1, { platform: 'whatsapp', external_id: '5511987654321' });
    });
    await screen.findByText('Trusted end-user added successfully.');
  });

  it('drops a national dialling prefix instead of storing it as part of the number', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'whatsapp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'BR' } });

    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '011987654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted status' }));

    await waitFor(() => {
      expect(vi.mocked(createExternalUser)).toHaveBeenCalledWith(1, { platform: 'whatsapp', external_id: '5511987654321' });
    });
  });

  it('refuses a number that already carries its own country code', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'whatsapp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'BR' } });

    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '5511987654321' } });
    expect(screen.getByText('This does not look like a valid phone number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add trusted status' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '11987654321' } });
    expect(screen.queryByText('This does not look like a valid phone number.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add trusted status' })).not.toBeDisabled();
  });

  it('shows a country select for SMS and prefixes its dial code onto the phone number', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'sms' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'FR' } });
    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '612345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted status' }));

    await waitFor(() => {
      expect(vi.mocked(createExternalUser)).toHaveBeenCalledWith(1, { platform: 'sms', external_id: '+33612345678' });
    });
    await screen.findByText('Trusted end-user added successfully.');
  });

  it('strips non-numeric characters as they are typed into the SMS phone number field', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'sms' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'FR' } });
    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: '61-23a45b678' } });

    expect(screen.getByPlaceholderText('5550000000')).toHaveValue('612345678');
  });

  it('hides the country select and dial code prefix once a WhatsApp Business user id is entered, and submits it unchanged', async () => {
    renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Messaging platform' }), { target: { value: 'whatsapp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'FR' } });
    expect(screen.getByText('🇫🇷 +33')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('5550000000'), { target: { value: 'US.1349120865530274' } });
    expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument();
    expect(screen.queryByText('🇫🇷 +33')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add trusted status' }));

    await waitFor(() => {
      expect(vi.mocked(createExternalUser)).toHaveBeenCalledWith(1, { platform: 'whatsapp', external_id: 'US.1349120865530274' });
    });
    await screen.findByText('Trusted end-user added successfully.');
  });
});
