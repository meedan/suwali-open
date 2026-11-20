import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import MessageTimestamp from './MessageTimestamp';

const renderTimestamp = (props: React.ComponentProps<typeof MessageTimestamp>) => render(
  <IntlProvider locale="en" messages={{}} timeZone="UTC">
    <Tooltip.Provider>
      <MessageTimestamp {...props} />
    </Tooltip.Provider>
  </IntlProvider>
);

describe('MessageTimestamp', () => {
  it('shows the full date and time in a tooltip on the time', async () => {
    renderTimestamp({ message: { created_at: '2026-10-27T15:45:12Z', direction: 'incoming' } as Message });

    fireEvent.focus(screen.getByText('03:45:12 PM').closest('[data-state]')!);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('October 27, 2026');
  });

  it('shows the delivery status for outgoing messages', () => {
    renderTimestamp({ message: { created_at: '2026-10-27T15:45:12Z', direction: 'outgoing', status: 'delivered' } as Message });

    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('hides the delivery status for incoming messages', () => {
    renderTimestamp({ message: { created_at: '2026-10-27T15:45:12Z', direction: 'incoming', status: 'delivered' } as Message });

    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
  });

  it('names the failure reason for a failed message', () => {
    renderTimestamp({ message: { created_at: '2026-10-27T15:45:12Z', direction: 'outgoing', status: 'failed', metadata: { delivery_error: { code: '403', message: 'Forbidden: bot was blocked by the user' } } } as Message });

    expect(screen.getByText('Failed: Forbidden: bot was blocked by the user')).toBeInTheDocument();
  });

  it('shows the time from a bare timestamp', () => {
    renderTimestamp({ timestamp: '2026-10-27T15:45:12Z' });

    expect(screen.getByText('03:45:12 PM')).toBeInTheDocument();
  });
});
