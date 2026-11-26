import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import * as TopicsService from '@services/TopicsService';

import { DataSourcesDocumentsFilter } from './DataSourcesDocumentsFilter';

// The topics of a list that it can be filtered by, as the server has them
vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn().mockImplementation(async (_hubId: number, _page: number, _perPage: number, _search: string, scope: { ids?: string } = {}) => {
    const topics = [{ id: 1, name: 'Climate', items_count: 12 }, { id: 2, name: 'Housing', items_count: 4 }];
    const data = scope.ids ? topics.filter(topic => scope.ids!.split(',').includes(String(topic.id))) : topics;
    return {
      data,
      untagged_count: 7,
      pagination: { current_page: 1, per_page: 50, total_pages: 1, total_count: data.length, next_page: null, prev_page: null, first_page: true, last_page: true },
    };
  }),
}));

// The team members of a hub that a summary can be filtered by
vi.mock('@services/HubService', () => ({ fetchHubEditors: vi.fn().mockResolvedValue([]) }));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({
    currentHubId: () => 1,
    currentHub: () => undefined,
  }),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions, trigger }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode; trigger: React.ReactNode }) => (
    <>
      {trigger}
      <dialog open>
        <div>{title}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    </>
  ),
}));

vi.mock('@ui-components/input/SelectInput', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <select value={value} onChange={e => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

// Shows what the filter has put in the address, which is what the lists are filtered by
const LocationProbe = () => <output aria-label="search">{useLocation().search}</output>;

const renderFilter = (props: Parameters<typeof DataSourcesDocumentsFilter>[0], initialEntry = '/') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <DataSourcesDocumentsFilter {...props} />
            <LocationProbe />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

const applied = () => new URLSearchParams(screen.getByLabelText('search').textContent ?? '');
const update = () => fireEvent.click(screen.getByRole('button', { name: 'Update filters' }));

describe('DataSourcesDocumentsFilter date published', () => {
  it('offers the date published filter when the source supports it', () => {
    renderFilter({ type: 'document', sourceId: 6, showDatePublished: true });

    expect(screen.getByText('Date published')).toBeInTheDocument();
  });

  it('does not offer the date published filter when the source does not support it', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    expect(screen.queryByText('Date published')).not.toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsFilter applying', () => {
  it('applies the filters chosen, and nothing before they are confirmed', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Important' }));
    fireEvent.click(screen.getByRole('radio', { name: 'In notebooks' }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'last_7_days' } });
    expect(applied().size).toBe(0);

    update();

    expect(Object.fromEntries(applied())).toEqual({
      status: 'paused',
      priority_tier: '2',
      notebooks: 'true',
      date_modified: 'last_7_days',
    });
  });

  it('applies the date published of a source that has one', () => {
    renderFilter({ type: 'document', sourceId: 6, showDatePublished: true });

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'today' } });
    update();

    expect(applied().get('date_published')).toBe('today');
  });

  it('applies the processing statuses that stay checked, all of them to begin with', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    expect(screen.getByRole('checkbox', { name: 'Complete' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Unsupported' })).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Error' }));
    update();

    expect(applied().get('sync_status')).toBe('complete,pending,unsupported');
  });

  it('checks again a processing status that was unchecked', () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?sync_status=complete');

    expect(screen.getByRole('checkbox', { name: 'Error' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Error' }));
    update();

    expect(applied().get('sync_status')).toBe('complete,error');
  });

  it('shows what is applied, and puts it back to what it was when cancelled', () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?status=active');

    expect(screen.getByRole('radio', { name: 'Active' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(applied().get('status')).toBe('active');
    expect(screen.getByRole('radio', { name: 'Active' })).toBeChecked();
  });

  it('clears the filters when reset, whatever was chosen', () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?status=active&notebooks=false');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(applied().size).toBe(0);
  });
});

describe('DataSourcesDocumentsFilter by kind of list', () => {
  it('offers unsupported files, and notebooks, of documents only and not the platforms', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    expect(screen.getByRole('checkbox', { name: 'Unsupported' })).toBeInTheDocument();
    expect(screen.getByText('Notebooks')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Telegram' })).not.toBeInTheDocument();
  });

  it('offers the platforms the hub is connected to, as checked, of contributions', () => {
    renderFilter({ type: 'contribution', connectedPlatforms: ['whatsapp', 'telegram'] });

    expect(screen.getByRole('checkbox', { name: 'WhatsApp' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SMS' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Unsupported' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Telegram' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'SMS' }));
    update();

    expect(applied().get('platforms')).toBe('whatsapp,sms');
  });

  it('offers no notebooks, nor unsupported files, of summaries, which have a date published', () => {
    renderFilter({ type: 'summary' });

    expect(screen.queryByText('Notebooks')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Unsupported' })).not.toBeInTheDocument();
    expect(screen.getByText('Date published')).toBeInTheDocument();
    expect(screen.getByText('Published by')).toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsFilter topics', () => {
  it('applies the topics chosen, and that they are not what is shown', async () => {
    renderFilter({ type: 'document', sourceId: 6 });

    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Climate 12' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Untagged 7' }));
    fireEvent.click(screen.getByRole('radio', { name: 'None of' }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search topics' }), { key: 'Escape' });
    expect(applied().size).toBe(0);

    update();

    expect(applied().get('topics')).toBe('1,none');
    expect(applied().get('topics_mode')).toBe('exclude');
  });

  it('shows the topics that are applied, by name, as one filter', async () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?topics=2&topics_mode=exclude');

    expect(await screen.findByText('Housing')).toBeInTheDocument();
    expect(screen.getByText('None of')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('does not keep how the topics filter once there are none, and takes the filter away with the last of them', async () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?topics=2&topics_mode=exclude');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Housing from the filter' }));
    update();

    expect(applied().has('topics')).toBe(false);
    expect(applied().has('topics_mode')).toBe(false);
  });

  it('does not apply how the topics filter when no topic is chosen', async () => {
    renderFilter({ type: 'document', sourceId: 6 });

    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'None of' }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search topics' }), { key: 'Escape' });
    update();

    expect(applied().size).toBe(0);
  });

  it('asks for the topics of the source of the documents, and of the kind of list for the others', async () => {
    const { unmount } = renderFilter({ type: 'document', sourceId: 6 });
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await screen.findByRole('checkbox', { name: 'Climate 12' });
    expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(1, 1, 50, '', { itemType: 'Document', sourceId: 6 });
    unmount();

    renderFilter({ type: 'contribution', connectedPlatforms: ['whatsapp'] });
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await screen.findByRole('checkbox', { name: 'Climate 12' });
    expect(TopicsService.fetchHubTopics).toHaveBeenCalledWith(1, 1, 50, '', { itemType: 'Contribution', sourceId: undefined });
  });

  it('is offered for summaries as it is for the others', () => {
    renderFilter({ type: 'summary' });

    expect(screen.getByText('Topics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add topic' })).toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsFilter contribution end-users', () => {
  it('filters by one type of end-user, and says nothing of both', () => {
    renderFilter({ type: 'contribution', connectedPlatforms: ['whatsapp', 'sms'] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Anonymous end-users' }));
    update();

    expect(applied().get('participants')).toBe('trusted');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Anonymous end-users' }));
    update();

    expect(applied().has('participants')).toBe(false);
  });

  it('does not let the last type of end-user be unchecked', () => {
    renderFilter({ type: 'contribution', connectedPlatforms: ['whatsapp', 'sms'] }, '/?participants=trusted');

    expect(screen.getByRole('checkbox', { name: 'Trusted end-users' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Anonymous end-users' })).toBeEnabled();
  });

  it('does not offer the end-user filter for documents', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    expect(screen.queryByText('Conversations with')).not.toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsFilter contribution platforms', () => {
  const connectedPlatforms: Array<'whatsapp' | 'telegram' | 'sms'> = ['whatsapp', 'telegram', 'sms'];

  it('does not let the last platform be unchecked', () => {
    renderFilter({ type: 'contribution', connectedPlatforms }, '/?platforms=sms');

    expect(screen.getByRole('checkbox', { name: 'SMS' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'WhatsApp' })).toBeEnabled();
  });

  it('filters by the platforms chosen, and says nothing of all of them', () => {
    renderFilter({ type: 'contribution', connectedPlatforms });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Telegram' }));
    update();

    expect(applied().get('platforms')).toBe('whatsapp,sms');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Telegram' }));
    update();

    expect(applied().has('platforms')).toBe(false);
  });
});

describe('DataSourcesDocumentsFilter processing', () => {
  it('filters by the processing statuses chosen, and says nothing of all of them', () => {
    renderFilter({ type: 'document', sourceId: 6 });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Error' }));
    update();

    expect(applied().get('sync_status')).toBe('complete,pending,unsupported');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Error' }));
    update();

    expect(applied().has('sync_status')).toBe(false);
  });
});

describe('DataSourcesDocumentsFilter count', () => {
  const connectedPlatforms: Array<'whatsapp' | 'telegram' | 'sms'> = ['whatsapp', 'telegram', 'sms'];

  it('does not count an old address that chooses everything the list shows without a filter', () => {
    renderFilter(
      { type: 'contribution', connectedPlatforms },
      '/?sync_status=complete,pending,error&platforms=sms,whatsapp,telegram&participants=anonymous,trusted',
    );

    expect(screen.getByRole('button', { name: 'Filters (0)' })).toBeInTheDocument();
  });

  it('counts a choice of less than that, and unsupported files as one of the options of documents', () => {
    renderFilter({ type: 'document', sourceId: 6 }, '/?sync_status=complete,pending,error');

    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });
});
