import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import SystemProcessing from './SystemProcessing';

const renderProcessing = (message?: Message, body = '...') => render(
  <IntlProvider locale="en" messages={{}}>
    <SystemProcessing message={message} body={body} />
  </IntlProvider>,
  { wrapper: Tooltip.Provider }
);

describe('SystemProcessing', () => {
  it('shows the time of the message', () => {
    renderProcessing({ created_at: '2026-10-27T15:45:12Z', direction: 'outgoing' } as Message);

    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('renders without a time for the synthetic contribution processing node, which has no message', () => {
    renderProcessing();

    expect(screen.queryByText('Time')).not.toBeInTheDocument();
  });

  it.each(['', '...'])('explains what the node represents instead of quoting an empty body (%j)', (body) => {
    const { container } = renderProcessing(undefined, body);

    expect(screen.getByText(/The system is processing/)).toBeInTheDocument();
    expect(container.querySelector('blockquote')).not.toBeInTheDocument();
  });

  it('quotes the body when there is one', () => {
    renderProcessing(undefined, 'Searching sources');

    expect(screen.getByText('Searching sources')).toBeInTheDocument();
  });
});
