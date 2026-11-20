import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import ActiveFilters from './ActiveFilters';

vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn().mockImplementation(async (_hubId: number, _page: number, _perPage: number, _search: string, scope: { ids?: string } = {}) => {
    const topics = [{ id: 1, name: 'Climate' }, { id: 2, name: 'Housing' }];
    return { data: topics.filter(topic => scope.ids?.split(',').includes(String(topic.id))) };
  }),
}));

vi.mock('@services/HubService', () => ({
  fetchHubEditors: vi.fn().mockResolvedValue([{ user: { id: 5, name: 'Ana', email: 'ana@example.com' } }]),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@ui-components/layout/Icon', () => ({ default: () => null }));

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

const LocationProbe = () => <output aria-label="search">{useLocation().search}</output>;

const renderBar = (props: Partial<Parameters<typeof ActiveFilters>[0]> = {}, initialEntry = '/') => {
  const onEdit = vi.fn();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ActiveFilters type="document" sourceId={6} density="compact" onDensityChange={vi.fn()} onEdit={onEdit} {...props as object} />
            <LocationProbe />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onEdit;
};

const applied = () => new URLSearchParams(screen.getByLabelText('search').textContent ?? '');

describe('ActiveFilters', () => {
  it('shows no filter button or chips without a filter, or with only what is not one', () => {
    renderBar({}, '/?status=all&date_modified=any&sort_by=title&sync_status=complete,pending,error,unsupported');

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('always shows the density toggle, and reports a change', () => {
    const onDensityChange = vi.fn();
    renderBar({ onDensityChange });

    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(onDensityChange).toHaveBeenCalledWith('comfortable');
  });

  it('shows a chip for each filter applied', () => {
    renderBar({}, '/?date_modified=last_7_days&status=paused&priority_tier=2&notebooks=false&sync_status=error,unsupported');

    expect(screen.getByRole('button', { name: 'Date modified: Last 7 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status: Paused' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priority tier: Important' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notebooks: Not in notebooks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Processing: Error and Unsupported' })).toBeInTheDocument();
  });

  it('opens the filters from a chip', () => {
    const onEdit = renderBar({}, '/?status=active');

    fireEvent.click(screen.getByRole('button', { name: 'Status: Active' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('opens the filters from the count that starts the row', () => {
    const onEdit = renderBar({ resultCount: 3, totalCount: 26 }, '/?status=active');

    fireEvent.click(screen.getByRole('button', { name: '3 of 26 entries' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('opens the filters from the count when nothing is filtered', () => {
    const onEdit = renderBar({ resultCount: 26, totalCount: 26 }, '/');

    fireEvent.click(screen.getByRole('button', { name: '26 entries' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('offers to clear all only when there is more than one chip to stop', async () => {
    renderBar({}, '/?status=active');
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();
  });

  it('counts each topic as a chip, for clearing all', async () => {
    renderBar({}, '/?topics=1,2');

    expect(await screen.findByRole('button', { name: 'Climate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument();
  });

  it('stops a filter from its chip, and keeps the others and the sort', () => {
    renderBar({}, '/?status=active&date_modified=today&sort_by=title');

    fireEvent.click(screen.getByRole('button', { name: 'Remove the Status filter' }));

    expect(Object.fromEntries(applied())).toEqual({ date_modified: 'today', sort_by: 'title' });
  });

  it('clears all the filters, but not the sort', () => {
    renderBar({}, '/?status=active&date_modified=today&sort_by=title');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));

    expect(Object.fromEntries(applied())).toEqual({ sort_by: 'title' });
  });

  it('names the topics, and stops them one at a time', async () => {
    renderBar({}, '/?topics=1,2,none');

    expect(await screen.findByRole('button', { name: 'Climate' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: MODE_LABEL })).toHaveValue('include');
    expect(screen.getByRole('button', { name: 'Untagged' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Climate from the filter' }));

    expect(applied().get('topics')).toBe('2,none');
  });

  it('shows a topic that is gone, to stop it', async () => {
    renderBar({}, '/?topics=1,99');

    expect(await screen.findByRole('button', { name: 'Unknown topic' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Unknown topic from the filter' }));

    expect(applied().get('topics')).toBe('1');
  });

  it('says the topics are not wanted when they are excluded, and forgets that with the last one', async () => {
    renderBar({}, '/?topics=1&topics_mode=exclude');

    expect(await screen.findByRole('button', { name: 'Climate' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: MODE_LABEL })).toHaveValue('exclude');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Climate from the filter' }));

    expect(applied().size).toBe(0);
  });

  it('switches between any and none of the topics from the row, saying only the way that is not the default', async () => {
    renderBar({}, '/?topics=1');

    fireEvent.change(await screen.findByRole('combobox', { name: MODE_LABEL }), { target: { value: 'exclude' } });
    expect(applied().get('topics_mode')).toBe('exclude');

    fireEvent.change(screen.getByRole('combobox', { name: MODE_LABEL }), { target: { value: 'include' } });
    expect(applied().has('topics_mode')).toBe(false);
    expect(applied().get('topics')).toBe('1');
  });

  it('shows the platforms of a contribution list, unless they are all of those connected', () => {
    renderBar({ type: 'contribution', connectedPlatforms: ['whatsapp', 'sms'] }, '/?platforms=whatsapp');

    expect(screen.getByRole('button', { name: 'Platform: WhatsApp' })).toBeInTheDocument();
  });

  it('shows the type of end-user of a contribution list, unless it is both', () => {
    renderBar({ type: 'contribution', connectedPlatforms: ['whatsapp', 'sms'] }, '/?participants=trusted');

    expect(screen.getByRole('button', { name: 'Conversations with: Trusted end-users' })).toBeInTheDocument();
  });

  it('shows no chip when both types of end-user are chosen', () => {
    renderBar({ type: 'contribution', connectedPlatforms: ['whatsapp', 'sms'] }, '/?participants=anonymous,trusted');

    expect(screen.queryByRole('button', { name: /Conversations with/ })).not.toBeInTheDocument();
  });

  it('names who a summary is published by', async () => {
    renderBar({ type: 'summary' }, '/?published_by=5');

    expect(await screen.findByRole('button', { name: 'Published by: Ana' })).toBeInTheDocument();
  });

  it('says how many entries the filters leave, once there are filters', () => {
    renderBar({ resultCount: 3, totalCount: 26 }, '/?status=active');

    expect(screen.getByRole('button', { name: '3 of 26 entries' })).toBeInTheDocument();
  });

  it('says one entry in the singular', () => {
    renderBar({ resultCount: 1, totalCount: 1 }, '/?status=active');

    expect(screen.getByText('1 of 1 entry')).toBeInTheDocument();
  });

  it('says when the filters leave nothing', () => {
    renderBar({ resultCount: 0, totalCount: 26 }, '/?status=active');

    expect(screen.getByText('0 of 26 entries')).toBeInTheDocument();
  });

  it('says nothing of the entries until they are known', () => {
    renderBar({}, '/?status=active');

    expect(screen.queryByText(/entr/)).not.toBeInTheDocument();
  });

  it('shows only the count without a filter', () => {
    renderBar({ resultCount: 26, totalCount: 26 }, '/');

    expect(screen.getByText('26 entries')).toBeInTheDocument();
  });
});
