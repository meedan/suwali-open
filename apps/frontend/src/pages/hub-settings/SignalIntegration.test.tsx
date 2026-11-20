import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { MessagingIntegration } from '@customTypes/messaging-integration';

import { connectMessagingIntegration, disconnectMessagingIntegration } from '@services/MessagingIntegrationsService';

import { ToastProvider } from '@hooks/useToast';

import SignalIntegration from './SignalIntegration';

vi.mock('@services/MessagingIntegrationsService', () => ({
  connectMessagingIntegration: vi.fn(),
  disconnectMessagingIntegration: vi.fn(),
}));

const signalIntegration = (overrides: Partial<MessagingIntegration>) => ({
  id: 7,
  platform: 'signal',
  active: false,
  ...overrides,
}) as MessagingIntegration;

const renderSignal = (integration?: MessagingIntegration, onChange = vi.fn()) => render(
  <IntlProvider locale="en" messages={{}}>
    <ToastPrimitive.Provider>
      <ToastProvider>
        <SignalIntegration hubId={1} integration={integration} onChange={onChange} onDisconnect={vi.fn()} />
      </ToastProvider>
      <ToastPrimitive.Viewport />
    </ToastPrimitive.Provider>
  </IntlProvider>
);

describe('SignalIntegration', () => {
  it('starts linking when connecting', async () => {
    const onChange = vi.fn();
    vi.mocked(connectMessagingIntegration).mockResolvedValue(signalIntegration({}));
    renderSignal(undefined, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Signal' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(connectMessagingIntegration).toHaveBeenCalledWith(1, 'signal');
  });

  it('shows the QR code to scan while linking is pending, with the time left', () => {
    const startedAt = new Date(Date.now() - 20_000).toISOString();
    const { container } = renderSignal(signalIntegration({ created_at: startedAt, signal_link: { uri: 'sgnl://linkdevice?uuid=abc&pub_key=def', status: 'pending' } }));

    expect(screen.getByText('Waiting for the QR code to be scanned…')).toBeInTheDocument();
    expect(screen.getByText('This QR code expires in 1:40.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('hides the QR code once it has expired and offers a new one', () => {
    const startedAt = new Date(Date.now() - 125_000).toISOString();
    const { container } = renderSignal(signalIntegration({ created_at: startedAt, signal_link: { uri: 'sgnl://linkdevice?uuid=abc&pub_key=def', status: 'pending' } }));

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('starts over with a new QR code after linking failed', async () => {
    const onChange = vi.fn();
    vi.mocked(connectMessagingIntegration).mockResolvedValue(signalIntegration({}));
    renderSignal(signalIntegration({ signal_link: { uri: 'sgnl://linkdevice?uuid=abc&pub_key=def', status: 'failed' } }), onChange);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(disconnectMessagingIntegration).toHaveBeenCalledWith(7);
    expect(connectMessagingIntegration).toHaveBeenCalledWith(1, 'signal');
  });

  it('links to the connected number on Signal', () => {
    renderSignal(signalIntegration({ active: true, phone_number: '+447520692068' }));

    expect(screen.getByRole('link', { name: '+447520692068' })).toHaveAttribute('href', 'https://signal.me/#p/+447520692068');
  });
});
