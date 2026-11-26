import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { HubTopic, HubTopicsPage } from '@customTypes/topic';

import * as TopicsService from '@services/TopicsService';

import { ToastProvider } from '@hooks/useToast';

import AddTopic from './AddTopic';

vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn(),
  addTopicItem: vi.fn(),
}));

// Whether the user can create a topic of the hub, which is for admins; any member can add the topics it has
const permissions = vi.hoisted(() => ({ createTopic: true }));

vi.mock('@services/AboutService', () => ({
  fetchAbout: vi.fn().mockResolvedValue({ max_topic_name_length: 255 }),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: permissions.createTopic }),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 3 }),
}));

// Stands in for the server: the topics by name that contain the search, a page of them at a time
const serve = (topics: HubTopic[]) => async (_hubId: number | string, page: number, perPage: number, search: string): Promise<HubTopicsPage> => {
  const matching = topics.filter(topic => topic.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(matching.length / perPage);
  return {
    data: matching.slice((page - 1) * perPage, page * perPage),
    pagination: {
      current_page: page,
      per_page: perPage,
      total_pages: totalPages,
      total_count: matching.length,
      next_page: page < totalPages ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null,
      first_page: page === 1,
      last_page: page >= totalPages,
    },
  };
};

const hubTopics: HubTopic[] = [
  { id: 1, name: 'Climate', items_count: 12 },
  { id: 2, name: 'Elections', items_count: 1 },
  { id: 3, name: 'Housing', items_count: 4 },
  { id: 4, name: 'Transport', items_count: 0 },
];

// Topics enough to need more than a page
const manyTopics: HubTopic[] = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  name: `Topic ${String(index + 1).padStart(3, '0')}`,
  items_count: index,
}));

// Lets a test say when the end of the list has been scrolled to, which the browser would
const observers: IntersectionObserverCallback[] = [];

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observers.push(callback);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

const scrollToEnd = () => act(() => {
  observers[observers.length - 1]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
});

const renderAddTopic = (existingTopicNames: string[] = [], onAdded = vi.fn()) => {
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <TooltipPrimitive.Provider>
              <AddTopic itemType="Document" itemId={7} existingTopicNames={existingTopicNames} onAdded={onAdded} />
            </TooltipPrimitive.Provider>
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return onAdded;
};

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
const search = () => screen.getByRole('searchbox', { name: 'Search topics' });
const searchFor = (value: string) => fireEvent.change(search(), { target: { value } });

describe('AddTopic', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.mocked(TopicsService.fetchHubTopics).mockReset().mockImplementation(serve(hubTopics));
    vi.mocked(TopicsService.addTopicItem).mockReset().mockResolvedValue({} as unknown as TopicsService.AddTopicItemResponse);
    permissions.createTopic = true;
  });

  it('lists the topics of the hub with how many items each is on, once opened', async () => {
    renderAddTopic();
    expect(TopicsService.fetchHubTopics).not.toHaveBeenCalled();

    open();

    expect(await screen.findByRole('button', { name: 'Climate, 12 items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elections, 1 item' })).toBeInTheDocument();
    expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, '');
  });

  it('shows a dash, and says none in words, for a topic that is on no item', async () => {
    renderAddTopic();

    open();

    const topic = await screen.findByRole('button', { name: 'Transport, 0 items' });
    expect(topic).toHaveTextContent('Transport–');
  });

  it('leaves out the topics the item already has', async () => {
    renderAddTopic(['Climate']);

    open();

    expect(await screen.findByRole('button', { name: 'Elections, 1 item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Climate/ })).not.toBeInTheDocument();
  });

  describe('searching', () => {
    it('asks the server for the topics that match, once typing pauses', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('ELEC');

      await waitFor(() => expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, 'ELEC'));
      expect(await screen.findByRole('button', { name: /^Elections/ })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: /^Climate/ })).not.toBeInTheDocument());
    });

    it('does not ask for every key typed, only for where typing paused', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('h');
      searchFor('ho');
      searchFor('hou');

      await waitFor(() => expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, 'hou'));
      const searches = vi.mocked(TopicsService.fetchHubTopics).mock.calls.map(call => call[3]);
      expect(searches).not.toContain('h');
      expect(searches).not.toContain('ho');
    });

    it('says when the topics that match are already on the item', async () => {
      renderAddTopic(['Housing']);
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('hou');

      expect(await screen.findByText('The topics that match your search are already on this item.')).toBeInTheDocument();
    });
  });

  describe('as the list is scrolled', () => {
    beforeEach(() => {
      vi.mocked(TopicsService.fetchHubTopics).mockImplementation(serve(manyTopics));
    });

    it('loads a page of topics at first, and the next once the end is reached', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Topic 001/ });
      expect(screen.getByRole('button', { name: /^Topic 050/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Topic 051/ })).not.toBeInTheDocument();

      await scrollToEnd();

      expect(await screen.findByRole('button', { name: /^Topic 051/ })).toBeInTheDocument();
      expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 2, 50, '');
    });

    it('keeps loading when every topic on a page is one the item already has', async () => {
      renderAddTopic(manyTopics.slice(0, 50).map(topic => topic.name));
      open();
      await waitFor(() => expect(TopicsService.fetchHubTopics).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(observers.length).toBeGreaterThan(0));
      expect(screen.queryByText('Every topic of this hub is already on this item.')).not.toBeInTheDocument();

      await scrollToEnd();

      expect(await screen.findByRole('button', { name: /^Topic 051/ })).toBeInTheDocument();
    });
  });

  it('says when the item has every topic of the hub', async () => {
    renderAddTopic(['Climate', 'Elections', 'Housing', 'Transport']);

    open();

    expect(await screen.findByText('Every topic of this hub is already on this item.')).toBeInTheDocument();
  });

  it('says when the hub has no topics', async () => {
    vi.mocked(TopicsService.fetchHubTopics).mockImplementation(serve([]));
    renderAddTopic();

    open();

    expect(await screen.findByText('This hub has no topics yet.')).toBeInTheDocument();
  });

  it('adds the chosen topic to the item, and closes the list', async () => {
    const onAdded = renderAddTopic();
    open();

    fireEvent.click(await screen.findByRole('button', { name: /^Housing/ }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(TopicsService.addTopicItem).toHaveBeenCalledWith({ topicId: 3, itemType: 'Document', itemId: 7 });
    await waitFor(() => expect(screen.queryByRole('searchbox', { name: 'Search topics' })).not.toBeInTheDocument());
  });

  describe('with Enter pressed in the search', () => {
    it('adds the first match', async () => {
      const onAdded = renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('hou');
      await waitFor(() => expect(screen.queryByRole('button', { name: /^Climate/ })).not.toBeInTheDocument());
      await screen.findByRole('button', { name: /^Housing/ });
      fireEvent.keyDown(search(), { key: 'Enter' });

      await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
      expect(TopicsService.addTopicItem).toHaveBeenCalledWith({ topicId: 3, itemType: 'Document', itemId: 7 });
    });

    it('adds nothing while the list is still the one for what was searched for before', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('hou');
      fireEvent.keyDown(search(), { key: 'Enter' });

      expect(TopicsService.addTopicItem).not.toHaveBeenCalled();
    });
  });

  describe('creating a topic', () => {
    const createRow = () => screen.getByRole('button', { name: /^Create/ });

    it('offers to create a topic named as what was typed, when the hub has none of that name', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('  Public transport ');

      expect(await screen.findByRole('button', { name: 'Create “Public transport”' })).toBeInTheDocument();
    });

    it('is not offered to a user who cannot create topics, who is still told that nothing matches', async () => {
      permissions.createTopic = false;
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('zzz');

      expect(await screen.findByText('No topics match your search.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
    });

    it('does not stop a user who cannot create topics from adding one the hub has', async () => {
      permissions.createTopic = false;
      renderAddTopic();
      open();

      fireEvent.click(await screen.findByRole('button', { name: /^Climate/ }));

      await waitFor(() => expect(TopicsService.addTopicItem).toHaveBeenCalledWith({ topicId: 1, itemType: 'Document', itemId: 7 }));
    });

    it('offers nothing to create until something is typed', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
    });

    it('does not offer to create a topic the hub has, whatever the case', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('climate');
      await screen.findByRole('button', { name: /^Climate/ });
      await waitFor(() => expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, 'climate'));

      expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
    });

    it('does not offer to create a topic the item already has', async () => {
      renderAddTopic(['Climate']);
      open();
      await screen.findByRole('button', { name: /^Elections/ });

      searchFor('Climate');
      await waitFor(() => expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, 'Climate'));
      await screen.findByText('The topics that match your search are already on this item.');

      expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
    });

    it('waits for the topics that match what was typed before offering, so it is not offered for one that exists', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('Public transport');

      expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
      await screen.findByRole('button', { name: /^Create/ });
    });

    it('stays below the message that nothing matches, and after the topics that do', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('zzz');
      await screen.findByRole('button', { name: 'Create “zzz”' });
      expect(screen.getByText('No topics match your search.')).toBeInTheDocument();

      searchFor('ho');
      await screen.findByRole('button', { name: /^Housing/ });
      expect(createRow()).toHaveTextContent('Create “ho”');
    });

    it('creates the topic, adds it to the item and closes the list when chosen', async () => {
      const onAdded = renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });
      searchFor('Public transport');

      vi.mocked(TopicsService.addTopicItem).mockResolvedValue({ id: 9, name: 'Public transport', topic_created: true });

      fireEvent.click(await screen.findByRole('button', { name: /^Create/ }));

      await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
      expect(TopicsService.addTopicItem).toHaveBeenCalledWith({ topicName: 'Public transport', itemType: 'Document', itemId: 7 });
      expect(await screen.findByText('Topic “Public transport” created and added')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('searchbox', { name: 'Search topics' })).not.toBeInTheDocument());
    });

    it('does not say a topic was created when the server used one the hub already had', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });
      searchFor('Public transport');
      vi.mocked(TopicsService.addTopicItem).mockResolvedValue({ id: 9, name: 'Public Transport', topic_created: false });

      fireEvent.click(await screen.findByRole('button', { name: /^Create/ }));

      await waitFor(() => expect(TopicsService.addTopicItem).toHaveBeenCalled());
      expect(screen.queryByText(/created and added/)).not.toBeInTheDocument();
    });

    it('does not say anything for a topic chosen from the list, as the chip shows it was added', async () => {
      renderAddTopic();
      open();
      vi.mocked(TopicsService.addTopicItem).mockResolvedValue({ id: 9, name: 'Housing', topic_created: false });

      fireEvent.click(await screen.findByRole('button', { name: /^Housing/ }));

      await waitFor(() => expect(TopicsService.addTopicItem).toHaveBeenCalled());
      expect(screen.queryByText(/created and added/)).not.toBeInTheDocument();
    });

    it('is not what Enter does in the search, which adds the first match and never creates', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('Public transport');
      await screen.findByRole('button', { name: /^Create/ });
      fireEvent.keyDown(search(), { key: 'Enter' });

      expect(TopicsService.addTopicItem).not.toHaveBeenCalled();
    });

    it('is reached with the arrow keys, after the last of the topics and from the search when none match', async () => {
      renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });

      searchFor('ho');
      await screen.findByRole('button', { name: /^Create/ });
      await screen.findByRole('button', { name: /^Housing/ });
      fireEvent.keyDown(search(), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('button', { name: /^Housing/ }), { key: 'ArrowDown' });
      expect(createRow()).toHaveFocus();

      fireEvent.keyDown(createRow(), { key: 'ArrowUp' });
      expect(screen.getByRole('button', { name: /^Housing/ })).toHaveFocus();

      searchFor('zzz');
      await screen.findByRole('button', { name: 'Create “zzz”' });
      fireEvent.keyDown(search(), { key: 'ArrowDown' });
      expect(createRow()).toHaveFocus();
    });

    it('keeps the list open and says so when the topic could not be created', async () => {
      vi.mocked(TopicsService.addTopicItem).mockRejectedValue(new Error('nope'));
      const onAdded = renderAddTopic();
      open();
      await screen.findByRole('button', { name: /^Climate/ });
      searchFor('Public transport');

      fireEvent.click(await screen.findByRole('button', { name: /^Create/ }));

      expect(await screen.findByText(/error adding the topic/i)).toBeInTheDocument();
      expect(onAdded).not.toHaveBeenCalled();
      expect(search()).toBeInTheDocument();
    });
  });

  it('moves between the topics with the arrow keys', async () => {
    renderAddTopic();
    open();
    await screen.findByRole('button', { name: /^Climate/ });

    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /^Climate/ })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: /^Climate/ }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /^Elections/ })).toHaveFocus();
  });

  it('keeps the list open and says so when the topic could not be added', async () => {
    vi.mocked(TopicsService.addTopicItem).mockRejectedValue(new Error('nope'));
    const onAdded = renderAddTopic();
    open();

    fireEvent.click(await screen.findByRole('button', { name: /^Housing/ }));

    expect(await screen.findByText(/error adding the topic/i)).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(search()).toBeInTheDocument();
  });
});
