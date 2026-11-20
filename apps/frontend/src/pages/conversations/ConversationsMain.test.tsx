import { IntlProvider } from 'react-intl';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Conversation } from '@customTypes/conversation';

import { getLastPath, setLastPath } from '@helpers/lastPath';

import { fetchConversation, fetchConversations } from '@services/ConversationsService';

import { HttpError } from '@root/NetworkLayer';

import ConversationsMain from './ConversationsMain';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1, hubUnavailable: () => false }),
}));

vi.mock('@services/ConversationsService', () => ({ fetchConversation: vi.fn(), fetchConversations: vi.fn() }));

vi.mock('@hooks/usePageTitle', () => ({ default: () => undefined }));

// Layout pulls in the hub, the account menu and the top navigation, which none of this depends on
vi.mock('@ui-components/layout/Layout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Left = ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>;
  Layout.Main = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return { Layout };
});

// Stands in for the title edit, which ends with this refetch
vi.mock('./ConversationStack', () => ({
  default: ({ conversation, refetchAroundId }: { conversation: Conversation; refetchAroundId: (id?: number) => void }) => (
    <article>
      {`Open conversation ${conversation.id}`}
      <button onClick={() => refetchAroundId(conversation.id)}>Rename</button>
    </article>
  ),
}));

// Stands in for the real sidebar's skeleton-or-list switch, which is what loses the scroll position
vi.mock('./ConversationsSidebar', () => ({
  default: ({ conversations, isPending, onConversationSelect, onJumpToTop }: {
    conversations: Conversation[];
    isPending: boolean;
    onConversationSelect: (conversation: Conversation) => void;
    onJumpToTop?: () => void;
  }) => (
    isPending
      ? <p>Loading conversations</p>
      : (
        <>
          {onJumpToTop && <button onClick={onJumpToTop}>Jump to top</button>}
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button onClick={() => onConversationSelect(conversation)}>{`Conversation ${conversation.id}`}</button>
              </li>
            ))}
          </ul>
        </>
      )
  ),
}));

const conversationsByFrom: Record<string, Conversation[]> = {
  audience: [1, 2, 3].map((id) => ({ id, hub_id: 1 }) as Conversation),
  team: [40, 41, 42].map((id) => ({ id, hub_id: 1 }) as Conversation),
};

const conversationsByPlatform: Record<string, Conversation[]> = {
  telegram: [5, 6].map((id) => ({ id, hub_id: 1 }) as Conversation),
  whatsapp: [],
};

const Path = () => <span data-testid="path">{useLocation().pathname}</span>;
const path = () => screen.getByTestId('path').textContent;

const renderAt = (initialPath: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/hub/1/conversations/:from" element={<ConversationsMain />} />
            <Route path="/hub/1/conversations/:from/:conversationId" element={<ConversationsMain />} />
          </Routes>
          <Link to="/hub/1/conversations/team">Team conversations</Link>
          <Link to="/hub/1/conversations/audience">Audience conversations</Link>
          <Link to="/hub/1/conversations/audience/3?platforms=telegram">Telegram only</Link>
          <Link to="/hub/1/conversations/audience/3?platforms=whatsapp">WhatsApp only</Link>
          <Path />
        </MemoryRouter>
      </IntlProvider>
    </QueryClientProvider>
  );
  return queryClient;
};

describe('ConversationsMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(fetchConversations).mockImplementation(async (_hubId, _aroundId, _windowSize, filter) => ({
      data: (filter as { platforms?: string }).platforms
        ? conversationsByPlatform[(filter as { platforms: string }).platforms]
        : conversationsByFrom[(filter as { from: string }).from],
      pagination: { has_previous: false, has_next: false, target_record_id: null },
    }) as unknown as Awaited<ReturnType<typeof fetchConversations>>);
    vi.mocked(fetchConversation).mockImplementation(async (id) => {
      if (id === 99) throw new HttpError(404, {}, new Headers());
      return { id, hub_id: id === 98 ? 2 : 1 } as Conversation;
    });
  });

  it('keeps the conversation list on screen when another conversation is selected', async () => {
    renderAt('/hub/1/conversations/audience/1');

    const otherConversation = await screen.findByRole('button', { name: 'Conversation 3' });
    fireEvent.click(otherConversation);

    await waitFor(() => expect(path()).toBe('/hub/1/conversations/audience/3'));
    // Swapping the list for a skeleton, even briefly, resets the sidebar's scroll to the top
    expect(screen.queryByText('Loading conversations')).not.toBeInTheDocument();
    expect(otherConversation).toBeInTheDocument();
  });

  it('loads the list around the last viewed conversation when switching to another view', async () => {
    setLastPath('conversationsLastPath:team', 1, '/conversations/team/42');
    renderAt('/hub/1/conversations/audience/1');
    await screen.findByRole('button', { name: 'Conversation 1' });

    fireEvent.click(screen.getByRole('link', { name: 'Team conversations' }));

    await waitFor(() => expect(path()).toBe('/hub/1/conversations/team/42'));
    expect(fetchConversations).toHaveBeenLastCalledWith(1, 42, expect.any(Number), expect.objectContaining({ from: 'team' }));
  });

  it('keeps the selected conversation when a background refetch returns a window without it', async () => {
    const queryClient = renderAt('/hub/1/conversations/audience/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation 3' }));
    await waitFor(() => expect(path()).toBe('/hub/1/conversations/audience/3'));

    vi.mocked(fetchConversations).mockResolvedValue({
      data: [7, 8, 9].map((id) => ({ id, hub_id: 1 }) as Conversation),
      pagination: { has_previous: true, has_next: true, target_record_id: 7 },
    } as unknown as Awaited<ReturnType<typeof fetchConversations>>);
    // What returning to the tab after the data has gone stale does
    await act(() => queryClient.invalidateQueries({ queryKey: ['/hubs/1/conversations'] }));
    await screen.findByRole('button', { name: 'Conversation 7' });

    expect(fetchConversations).toHaveBeenLastCalledWith(1, 3, expect.any(Number), expect.objectContaining({ from: 'audience' }));
    expect(path()).toBe('/hub/1/conversations/audience/3');
  });

  it('keeps the selected conversation open when a filter leaves it out', async () => {
    renderAt('/hub/1/conversations/audience/3');
    await screen.findByText('Open conversation 3');

    fireEvent.click(screen.getByRole('link', { name: 'Telegram only' }));

    await screen.findByRole('button', { name: 'Conversation 5' });
    expect(screen.getByText('Open conversation 3')).toBeInTheDocument();
    expect(path()).toBe('/hub/1/conversations/audience/3');
  });

  it('keeps the selected conversation open when a filter matches none', async () => {
    renderAt('/hub/1/conversations/audience/3');
    await screen.findByText('Open conversation 3');

    fireEvent.click(screen.getByRole('link', { name: 'WhatsApp only' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Conversation / })).not.toBeInTheDocument());
    expect(screen.getByText('Open conversation 3')).toBeInTheDocument();
    expect(path()).toBe('/hub/1/conversations/audience/3');
  });

  it('keeps the selected conversation open when jumping to the top of the list', async () => {
    vi.mocked(fetchConversations).mockImplementation(async (_hubId, aroundId) => ({
      data: (aroundId && aroundId >= 8 ? [8, 9] : [1, 2]).map((id) => ({ id, hub_id: 1 }) as Conversation),
      pagination: { has_previous: Boolean(aroundId && aroundId >= 8), has_next: false, target_record_id: aroundId ?? 1 },
    }) as unknown as Awaited<ReturnType<typeof fetchConversations>>);
    renderAt('/hub/1/conversations/audience/9');
    await screen.findByText('Open conversation 9');

    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));

    await screen.findByRole('button', { name: 'Conversation 1' });
    expect(screen.getByText('Open conversation 9')).toBeInTheDocument();
    expect(path()).toBe('/hub/1/conversations/audience/9');
  });

  it('keeps the list at the top when the open conversation is renamed after a jump', async () => {
    vi.mocked(fetchConversations).mockImplementation(async (_hubId, aroundId) => ({
      data: (aroundId && aroundId >= 8 ? [8, 9] : [1, 2]).map((id) => ({ id, hub_id: 1 }) as Conversation),
      pagination: { has_previous: Boolean(aroundId && aroundId >= 8), has_next: false, target_record_id: aroundId ?? 1 },
    }) as unknown as Awaited<ReturnType<typeof fetchConversations>>);
    renderAt('/hub/1/conversations/audience/9');
    await screen.findByText('Open conversation 9');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));
    await screen.findByRole('button', { name: 'Conversation 1' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(fetchConversation).toHaveBeenCalledTimes(2));
    expect(fetchConversations).toHaveBeenLastCalledWith(1, 2, expect.anything(), expect.anything());
    expect(screen.getByRole('button', { name: 'Conversation 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversation 8' })).not.toBeInTheDocument();
  });

  // Where the sidebar goes after removing a conversation
  it('leaves nothing open when the URL drops the conversation', async () => {
    setLastPath('conversationsLastPath:audience', 1, '/conversations/audience/3');
    renderAt('/hub/1/conversations/audience/3');
    await screen.findByText('Open conversation 3');

    fireEvent.click(screen.getByRole('link', { name: 'Audience conversations' }));

    await waitFor(() => expect(screen.queryByText('Open conversation 3')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Conversation 1' })).toBeInTheDocument();
    expect(path()).toBe('/hub/1/conversations/audience');
  });

  it.each([
    ['is missing or hidden', 99],
    ['belongs to another hub', 98],
  ])('shows not found beside the list when the linked conversation %s', async (_case, conversationId) => {
    setLastPath('conversationsLastPath', 1, '/conversations/audience/2');
    renderAt(`/hub/1/conversations/audience/${conversationId}`);

    expect(await screen.findByRole('heading', { name: 'This content is not available' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Conversation 1' })).toBeInTheDocument();
    expect(path()).toBe(`/hub/1/conversations/audience/${conversationId}`);
    expect(getLastPath('conversationsLastPath', 1)).toBeNull();
  });

  it('shows not found when the open conversation is removed after the list moved past it', async () => {
    vi.mocked(fetchConversations).mockImplementation(async (_hubId, aroundId) => ({
      data: (aroundId && aroundId >= 8 ? [8, 9] : [1, 2]).map((id) => ({ id, hub_id: 1 }) as Conversation),
      pagination: { has_previous: Boolean(aroundId && aroundId >= 8), has_next: false, target_record_id: aroundId ?? 1 },
    }) as unknown as Awaited<ReturnType<typeof fetchConversations>>);
    const queryClient = renderAt('/hub/1/conversations/audience/9');
    await screen.findByText('Open conversation 9');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));
    await screen.findByRole('button', { name: 'Conversation 1' });

    vi.mocked(fetchConversation).mockRejectedValue(new HttpError(404, {}, new Headers()));
    await act(() => queryClient.invalidateQueries({ queryKey: ['/conversations/9'] }));

    expect(await screen.findByRole('heading', { name: 'This content is not available' })).toBeInTheDocument();
    expect(screen.queryByText('Open conversation 9')).not.toBeInTheDocument();
  });
});
