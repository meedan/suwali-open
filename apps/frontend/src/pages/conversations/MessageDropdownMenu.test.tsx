import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import MessageSelectProvider from '@contexts/MessageSelectContext';

import MessageDropdownMenu from './MessageDropdownMenu';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@components/AddToNotebookModal', () => ({
  default: () => null,
}));

vi.mock('@ui-components/input/ReportMessageModal', () => ({
  default: () => null,
}));

const message = { id: 1, direction: 'outgoing' } as unknown as Message;

const renderMenu = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <MessageSelectProvider>
            <MessageDropdownMenu message={message} />
          </MessageSelectProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('MessageDropdownMenu', () => {
  it('shows a Select message option when the message is not highlighted', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Select message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deselect message' })).not.toBeInTheDocument();
  });

  it('switches to a Deselect message option once selected, and back once deselected', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Select message' }));
    expect(screen.getByRole('button', { name: 'Deselect message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select message' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deselect message' }));
    expect(screen.getByRole('button', { name: 'Select message' })).toBeInTheDocument();
  });

  describe('Copy permalink', () => {
    const copyPermalinkFrom = async (path: string) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      window.history.pushState({}, '', path);

      renderMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Copy permalink for this message' }));
      await waitFor(() => expect(writeText).toHaveBeenCalled());

      const url = new URL(writeText.mock.calls[0][0]);

      return url.pathname + url.search;
    };

    it('clears the platform filter for an audience conversation', async () => {
      expect(await copyPermalinkFrom('/hub/1/conversations/audience/5')).toBe('/hub/1/conversations/audience/5?platforms=any&messageId=1');
    });

    it('links to the team view for one of your own conversations', async () => {
      expect(await copyPermalinkFrom('/hub/1/conversations/me/5')).toBe('/hub/1/conversations/team/5?messageId=1');
    });

    it('links only to the message for a team conversation', async () => {
      expect(await copyPermalinkFrom('/hub/1/conversations/team/5')).toBe('/hub/1/conversations/team/5?messageId=1');
    });
  });
});
