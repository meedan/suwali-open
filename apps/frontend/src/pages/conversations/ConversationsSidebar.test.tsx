import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { Conversation, ConversationFrom } from '@customTypes/conversation';

import { deleteConversation } from '@services/ConversationsService';

import { buildConversation } from '@root/test/fixtures/conversation';

import { ToastProvider } from '@hooks/useToast';

import ConversationsSidebar from './ConversationsSidebar';

type SidebarProps = React.ComponentProps<typeof ConversationsSidebar>;

const capabilities = vi.hoisted(() => ({ isWriteAdmin: true }));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: (action: string) => ({ allowed: action === 'IS_WRITE_ADMIN' && capabilities.isWriteAdmin }),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1, currentHub: () => undefined }),
}));

vi.mock('@services/ConversationsService', () => ({
  fetchConversations: vi.fn().mockResolvedValue({ data: [], pagination: { total_count: 0 } }),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));

// The selector and permissions have their own tests; only the list is under test here
vi.mock('@components/ConversationTypeSelector', () => ({
  default: () => <div data-testid="type-selector" />,
}));

vi.mock('@components/Can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const LocationProbe = () => <div data-testid="location">{useLocation().pathname}</div>;

const renderSidebar = (from: ConversationFrom, conversations: Conversation[] = [], search = '', onJumpToTop?: () => void, props: Partial<SidebarProps> = {}) =>
  render(
    <MemoryRouter initialEntries={[`/conversations/${from}${search}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastPrimitive.Provider>
              <ToastProvider>
                <ConversationsSidebar
                  activeConversationId={null}
                  conversations={conversations}
                  conversationTitleMapper={conversation => conversation.title}
                  from={from}
                  onJumpToTop={onJumpToTop}
                  {...props}
                />
                <LocationProbe />
              </ToastProvider>
            </ToastPrimitive.Provider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

// The empty state's message is one paragraph, with the filter hint as a second sentence inside it
const emptyMessage = () => screen.getByText(/No conversations available\./);
const emptyState = () => emptyMessage().parentElement!;

describe('ConversationsSidebar', () => {
  beforeEach(() => {
    capabilities.isWriteAdmin = true;
    vi.mocked(deleteConversation).mockReset();
  });

  it.each(['audience', 'me', 'team'] as const)('offers filters in the toolbar for %s conversations', (from) => {
    // The toolbar button is compact — icon and count only, no "Filters" word — unlike the empty state's
    const { container } = renderSidebar(from);

    expect(container.querySelector('use[href="/assets/icons/filter.svg?#icon"]')).toBeInTheDocument();
  });

  it.each(['audience', 'me', 'team'] as const)('does not suggest changing filters when %s has none applied', (from) => {
    renderSidebar(from);

    expect(emptyMessage()).not.toHaveTextContent('Try a different set of filters to show conversations.');
    expect(within(emptyState()).queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();
  });

  it.each(['audience', 'me', 'team'] as const)('suggests changing filters when %s has filters applied', (from) => {
    renderSidebar(from, [], '?last_message=last_7_days');

    expect(emptyMessage()).toHaveTextContent('Try a different set of filters to show conversations.');
    expect(within(emptyState()).getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('offers to jump to the top of the list when given a handler', () => {
    const onJumpToTop = vi.fn();
    renderSidebar('audience', [buildConversation()], '', onJumpToTop);

    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));

    expect(onJumpToTop).toHaveBeenCalledOnce();
  });

  it('does not offer to jump to the top of the list without a handler', () => {
    renderSidebar('audience', [buildConversation()]);

    expect(screen.queryByRole('button', { name: 'Jump to top' })).not.toBeInTheDocument();
  });

  describe('deleting a conversation', () => {
    it('offers delete on audience conversations when the user is a write super admin', () => {
      renderSidebar('audience', [buildConversation()]);

      expect(screen.getByRole('button', { name: 'Remove conversation' })).toBeInTheDocument();
    });

    it('does not offer delete on audience conversations when the user is not a write super admin', () => {
      capabilities.isWriteAdmin = false;
      renderSidebar('audience', [buildConversation()]);

      expect(screen.queryByRole('button', { name: 'Remove conversation' })).not.toBeInTheDocument();
    });

    it('does not offer delete on team conversations', () => {
      renderSidebar('team', [buildConversation()]);

      expect(screen.queryByRole('button', { name: 'Remove conversation' })).not.toBeInTheDocument();
    });

    it('offers delete on your own conversations regardless of the capability', () => {
      capabilities.isWriteAdmin = false;
      renderSidebar('me', [
        buildConversation({
          platform: 'internal',
          participant: {
            type: 'User',
            id: 1,
            confirmed: true,
            email: 'user@example.org',
            name: 'Test User',
            profile_picture_url: null,
            is_public_email_domain: false,
            is_admin: false,
            is_write_admin: false,
          },
          participant_id: 1,
        }),
      ]);

      expect(screen.getByRole('button', { name: 'Remove conversation' })).toBeInTheDocument();
    });

    it('deletes the conversation after confirming and returns to the audience list', async () => {
      vi.mocked(deleteConversation).mockResolvedValue({ message: 'Conversation deleted' });
      renderSidebar('audience', [buildConversation()]);

      fireEvent.click(screen.getByRole('button', { name: 'Remove conversation' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: /Remove conversation\?/ })).getByRole('button', { name: 'Remove conversation' }));

      await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(7));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/conversations/audience'));
    });

    it.each([
      ['the next one', 7, 8],
      ['the previous one when it was last', 8, 7],
    ])('opens %s after removing the open conversation', async (_case, removedId, nextId) => {
      vi.mocked(deleteConversation).mockResolvedValue({ message: 'Conversation deleted' });
      const onConversationSelect = vi.fn();
      const refetchAroundId = vi.fn().mockResolvedValue(undefined);
      const conversations = [buildConversation({ id: 6, title: 'First' }), buildConversation({ id: 7, title: 'Second' }), buildConversation({ id: 8, title: 'Third' })];
      renderSidebar('audience', conversations, '', undefined, { activeConversationId: removedId, onConversationSelect, refetchAroundId });

      fireEvent.click(screen.getAllByRole('button', { name: 'Remove conversation' })[removedId - 6]);
      fireEvent.click(within(screen.getByRole('dialog', { name: /Remove conversation\?/ })).getByRole('button', { name: 'Remove conversation' }));

      await waitFor(() => expect(onConversationSelect).toHaveBeenCalledWith(expect.objectContaining({ id: nextId }), true));
      expect(refetchAroundId).toHaveBeenCalledWith(nextId);
    });

    it('keeps the open conversation when removing another one', async () => {
      vi.mocked(deleteConversation).mockResolvedValue({ message: 'Conversation deleted' });
      const onConversationSelect = vi.fn();
      const conversations = [buildConversation({ id: 6, title: 'First' }), buildConversation({ id: 7, title: 'Second' })];
      renderSidebar('audience', conversations, '', undefined, { activeConversationId: 6, onConversationSelect });

      fireEvent.click(screen.getAllByRole('button', { name: 'Remove conversation' })[1]);
      fireEvent.click(within(screen.getByRole('dialog', { name: /Remove conversation\?/ })).getByRole('button', { name: 'Remove conversation' }));

      await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(7));
      expect(onConversationSelect).not.toHaveBeenCalled();
    });
  });
});
