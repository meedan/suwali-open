import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { HubTopic, HubTopicsPage } from '@customTypes/topic';

import * as TopicsService from '@services/TopicsService';

import TopicsFilter from './TopicsFilter';

vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn(),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 3 }),
}));

// A native select stands in for the Radix one, which happy-dom cannot open
vi.mock('@ui-components/input/SelectInput', () => ({
  Select: ({ children, value, 'aria-label': ariaLabel, onValueChange }: { children: React.ReactNode; value?: string; 'aria-label'?: string; onValueChange?: (value: string) => void }) => (
    <select aria-label={ariaLabel} value={value} onChange={e => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

const MODE_LABEL = 'Show items with any or none of the topics';

const hubTopics: HubTopic[] = [
  { id: 1, name: 'Climate', items_count: 12 },
  { id: 2, name: 'Housing', items_count: 4 },
  { id: 3, name: 'Transport', items_count: 1 },
];

const pageOf = (data: HubTopic[], untagged_count = 7): HubTopicsPage => ({
  data,
  untagged_count,
  pagination: { current_page: 1, per_page: 50, total_pages: 1, total_count: data.length, next_page: null, prev_page: null, first_page: true, last_page: true },
});

// Stands in for the server: the topics that contain the search, or those asked for by id
const serve = async (_hubId: number | string, _page: number, _perPage: number, search: string, scope: { ids?: string } = {}) => {
  const ids = scope.ids?.split(',');
  return pageOf(hubTopics.filter(topic => topic.name.toLowerCase().includes(search.toLowerCase()) && (!ids || ids.includes(String(topic.id)))));
};

const renderFilter = (props: Partial<React.ComponentProps<typeof TopicsFilter>> = {}) => {
  const onTopicsChange = vi.fn();
  const onModeChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlProvider locale="en" messages={{}}>
        <TopicsFilter itemType="Document" sourceId={6} onTopicsChange={onTopicsChange} onModeChange={onModeChange} {...props} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { onTopicsChange, onModeChange };
};

const openPicker = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
  await screen.findByRole('textbox', { name: 'Search topics' });
};

describe('TopicsFilter', () => {
  beforeEach(() => {
    vi.mocked(TopicsService.fetchHubTopics).mockReset().mockImplementation(serve);
  });

  describe('the topics chosen', () => {
    it('says there is no topic chosen, and asks for none, when no topic is chosen', () => {
      renderFilter();

      expect(screen.getByText('Any topic')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
      expect(TopicsService.fetchHubTopics).not.toHaveBeenCalled();
    });

    it('shows them by name, asking for the ones in the list that is filtered', async () => {
      renderFilter({ topics: '2,1,none' });

      expect(screen.queryByText('Any topic')).not.toBeInTheDocument();
      expect(await screen.findByText('Housing')).toBeInTheDocument();
      expect(screen.getByText('Climate')).toBeInTheDocument();
      expect(screen.getByText('Untagged')).toBeInTheDocument();
      expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 100, '', { itemType: 'Document', sourceId: 6, ids: '2,1' });
    });

    it('removes the one whose button is pressed, and no other', async () => {
      const { onTopicsChange } = renderFilter({ topics: '2,1,none' });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove Housing from the filter' }));

      expect(onTopicsChange).toHaveBeenCalledWith('1,none');
    });

    it('removes untagged', async () => {
      const { onTopicsChange } = renderFilter({ topics: '1,none' });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove Untagged from the filter' }));

      expect(onTopicsChange).toHaveBeenCalledWith('1');
    });
  });

  describe('whether the topics are or are not what is shown', () => {
    it('is chosen in the topics to choose from, and is until it is not', async () => {
      renderFilter();
      await openPicker();

      expect(screen.getByRole('radio', { name: 'Any of' })).toBeChecked();
    });

    it('is not when it is said to be, and says so when chosen', async () => {
      const { onModeChange } = renderFilter({ mode: 'exclude' });
      await openPicker();

      expect(screen.getByRole('radio', { name: 'None of' })).toBeChecked();
      fireEvent.click(screen.getByRole('radio', { name: 'Any of' }));

      expect(onModeChange).toHaveBeenCalledWith(undefined);
    });

    it('says only the way that is not the default', async () => {
      const { onModeChange } = renderFilter();
      await openPicker();

      fireEvent.click(screen.getByRole('radio', { name: 'None of' }));

      expect(onModeChange).toHaveBeenCalledWith('exclude');
    });

    it('stays as it is when the one that is chosen is chosen again', async () => {
      const { onModeChange } = renderFilter({ mode: 'exclude' });
      await openPicker();

      fireEvent.click(screen.getByRole('radio', { name: 'None of' }));

      expect(onModeChange).not.toHaveBeenCalled();
    });

    it('is shown beside the topics chosen, while the topics to choose from are closed', async () => {
      renderFilter({ topics: 'none', mode: 'exclude' });

      expect(await screen.findByRole('combobox', { name: MODE_LABEL })).toHaveValue('exclude');
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('is shown as is when it is not said to be not', async () => {
      renderFilter({ topics: 'none' });

      expect(await screen.findByRole('combobox', { name: MODE_LABEL })).toHaveValue('include');
    });

    it('can be changed beside the topics chosen, saying only the way that is not the default', async () => {
      const { onModeChange } = renderFilter({ topics: '1' });

      fireEvent.change(await screen.findByRole('combobox', { name: MODE_LABEL }), { target: { value: 'exclude' } });
      expect(onModeChange).toHaveBeenLastCalledWith('exclude');

      fireEvent.change(screen.getByRole('combobox', { name: MODE_LABEL }), { target: { value: 'include' } });
      expect(onModeChange).toHaveBeenLastCalledWith(undefined);
    });

    it('is not shown when there are no topics chosen to say it of', () => {
      renderFilter({ mode: 'exclude' });

      expect(screen.queryByRole('combobox', { name: MODE_LABEL })).not.toBeInTheDocument();
    });

    it('goes back to the default when the last topic is removed', async () => {
      const { onTopicsChange, onModeChange } = renderFilter({ topics: 'none', mode: 'exclude' });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove Untagged from the filter' }));

      expect(onTopicsChange).toHaveBeenCalledWith('');
      expect(onModeChange).toHaveBeenCalledWith(undefined);
    });

    it('stays as it is while there are topics left', async () => {
      const { onModeChange } = renderFilter({ topics: '1,none', mode: 'exclude' });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove Untagged from the filter' }));

      expect(onModeChange).not.toHaveBeenCalled();
    });
  });

  describe('choosing the topics', () => {
    it('lists the topics of the list, with how many of its items each is on, and how many have none', async () => {
      renderFilter();
      await openPicker();

      expect(await screen.findByRole('checkbox', { name: 'Climate 12' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Housing 4' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Untagged 7' })).toBeInTheDocument();
      expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, '', { itemType: 'Document', sourceId: 6 });
    });

    it('asks for the topics of the kind of list it is for', async () => {
      renderFilter({ itemType: 'Contribution', sourceId: undefined });
      await openPicker();

      await waitFor(() => {
        expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, '', { itemType: 'Contribution', sourceId: undefined });
      });
    });

    it('adds the topic chosen to those that are', async () => {
      const { onTopicsChange } = renderFilter({ topics: '1' });
      await openPicker();

      fireEvent.click(await screen.findByRole('checkbox', { name: 'Housing 4' }));

      expect(onTopicsChange).toHaveBeenCalledWith('1,2');
    });

    it('takes away the topic chosen again, and shows the ones that are chosen as checked', async () => {
      const { onTopicsChange } = renderFilter({ topics: '1,2' });
      await openPicker();

      expect(await screen.findByRole('checkbox', { name: 'Climate 12' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Transport 1' })).not.toBeChecked();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Climate 12' }));

      expect(onTopicsChange).toHaveBeenCalledWith('2');
    });

    it('chooses untagged as it does a topic', async () => {
      const { onTopicsChange } = renderFilter({ topics: '1' });
      await openPicker();

      fireEvent.click(await screen.findByRole('checkbox', { name: 'Untagged 7' }));

      expect(onTopicsChange).toHaveBeenCalledWith('1,none');
    });

    it('stays open for more to be chosen', async () => {
      renderFilter();
      await openPicker();

      fireEvent.click(await screen.findByRole('checkbox', { name: 'Climate 12' }));

      expect(screen.getByRole('textbox', { name: 'Search topics' })).toBeInTheDocument();
    });

    it('searches the topics by what is typed, and offers untagged only when nothing is', async () => {
      renderFilter();
      await openPicker();
      await screen.findByRole('checkbox', { name: 'Untagged 7' });

      fireEvent.change(screen.getByRole('textbox', { name: 'Search topics' }), { target: { value: 'hou' } });

      expect(await screen.findByRole('checkbox', { name: 'Housing 4' })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Climate 12' })).not.toBeInTheDocument());
      expect(screen.queryByRole('checkbox', { name: /^Untagged/ })).not.toBeInTheDocument();
      expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(3, 1, 50, 'hou', { itemType: 'Document', sourceId: 6 });
    });

    it('says when nothing matches the search', async () => {
      renderFilter();
      await openPicker();

      fireEvent.change(screen.getByRole('textbox', { name: 'Search topics' }), { target: { value: 'zzz' } });

      expect(await screen.findByText('No topics match your search.')).toBeInTheDocument();
    });

    it('says when none of the items have topics, which leaves nothing to choose', async () => {
      vi.mocked(TopicsService.fetchHubTopics).mockResolvedValue(pageOf([], 0));
      renderFilter();
      await openPicker();

      expect(await screen.findByText('None of the items in this list have topics yet.')).toBeInTheDocument();
    });

    it('says when the topics could not be loaded', async () => {
      vi.mocked(TopicsService.fetchHubTopics).mockRejectedValue(new Error('nope'));
      renderFilter();
      await openPicker();

      expect(await screen.findByText('The topics could not be loaded. Please try again.')).toBeInTheDocument();
    });
  });
});
