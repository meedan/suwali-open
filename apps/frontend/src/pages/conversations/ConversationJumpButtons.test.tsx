import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ConversationJumpButtons from './ConversationJumpButtons';

const renderButtons = ({ hasUnloadedOlder = false, hasUnloadedNewer = false } = {}) => {
  const onJumpToFirst = vi.fn();
  const onJumpToLatest = vi.fn();

  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <div id="conversation-messages" />
        <ConversationJumpButtons
          containerElementId="conversation-messages"
          itemCount={20}
          hasUnloadedOlder={hasUnloadedOlder}
          hasUnloadedNewer={hasUnloadedNewer}
          onJumpToFirst={onJumpToFirst}
          onJumpToLatest={onJumpToLatest}
        />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

  return { onJumpToFirst, onJumpToLatest };
};

describe('ConversationJumpButtons', () => {
  it('shows no buttons when the whole conversation is loaded and in view', () => {
    renderButtons();

    expect(screen.queryByRole('button', { name: 'Jump to first message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).not.toBeInTheDocument();
  });

  it('jumps to the first message when older messages are not loaded', () => {
    const { onJumpToFirst, onJumpToLatest } = renderButtons({ hasUnloadedOlder: true });

    fireEvent.click(screen.getByRole('button', { name: 'Jump to first message' }));

    expect(onJumpToFirst).toHaveBeenCalledTimes(1);
    expect(onJumpToLatest).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).not.toBeInTheDocument();
  });

  it('jumps to the latest message when newer messages are not loaded', () => {
    const { onJumpToFirst, onJumpToLatest } = renderButtons({ hasUnloadedNewer: true });

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest message' }));

    expect(onJumpToLatest).toHaveBeenCalledTimes(1);
    expect(onJumpToFirst).not.toHaveBeenCalled();
  });
});
