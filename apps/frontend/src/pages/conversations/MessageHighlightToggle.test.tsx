import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import MessageSelectProvider from '@contexts/MessageSelectContext';

import MessageHighlightToggle from './MessageHighlightToggle';

const message = { id: 1, direction: 'incoming' } as unknown as Message;

const renderToggle = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <MessageSelectProvider>
            <MessageHighlightToggle message={message} />
          </MessageSelectProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('MessageHighlightToggle', () => {
  it('renders unselected by default', () => {
    renderToggle();

    expect(screen.getByRole('button', { name: 'Select message', pressed: false })).toBeInTheDocument();
  });

  it('selects the message when clicked', () => {
    renderToggle();

    fireEvent.click(screen.getByRole('button', { name: 'Select message' }));

    expect(screen.getByRole('button', { name: 'Deselect message', pressed: true })).toBeInTheDocument();
  });

  it('deselects the message when clicked again', () => {
    renderToggle();

    fireEvent.click(screen.getByRole('button', { name: 'Select message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deselect message' }));

    expect(screen.getByRole('button', { name: 'Select message', pressed: false })).toBeInTheDocument();
  });
});
