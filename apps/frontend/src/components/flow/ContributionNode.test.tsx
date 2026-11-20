import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import MessageSelectProvider, { useMessageHighlight } from '@contexts/MessageSelectContext';

import ContributionNode from './ContributionNode';

// Handle needs the node id context React Flow provides, which is not exported
vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  Handle: () => null,
}));

const messageObject = { id: 7, body: 'Thanks' } as unknown as Message;

const HighlightedId = () => <span data-testid="highlighted">{String(useMessageHighlight().highlightMessageId)}</span>;

const renderNode = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <MessageSelectProvider>
          <ContributionNode
            data={{
              id: 7,
              body: 'Thanks',
              type: 'user_contribution_submitted',
              isFirst: false,
              isLast: true,
              hasBranch: false,
              metadata: messageObject.metadata,
              messageObject,
            }}
          />
          <HighlightedId />
        </MessageSelectProvider>
      </IntlProvider>
    </MemoryRouter>,
    { wrapper: Tooltip.Provider }
  );

describe('ContributionNode', () => {
  it('highlights its message when clicked, and keeps it highlighted when clicked again', () => {
    renderNode();
    const node = screen.getByRole('button', { name: /Contribution/ });

    expect(node).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(node);
    expect(screen.getByTestId('highlighted')).toHaveTextContent('7');
    expect(node).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(node);
    expect(screen.getByTestId('highlighted')).toHaveTextContent('7');
  });
});
