import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import DataSourceItemRow, { DataSourceItemDateCell } from './DataSourceItemRow';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

const item = {
  id: 7,
  active: true,
  sync_status: 'complete' as const,
  priority_tier: 1 as const,
  updated_at: '2026-02-10T12:00:00Z',
};

// Shows the address the row leaves the list at, as the list's filters live in it
const Location = () => <output>{useLocation().search}</output>;

const renderRow = (ui: React.ReactNode, initialEntry = '/') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Location />
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <table>
            <tbody>{ui}</tbody>
          </table>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('DataSourceItemRow', () => {
  it('shows the title and the date modified', () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" />);

    expect(screen.getByText('A tidy document')).toBeInTheDocument();
    expect(screen.getByText(new Date(item.updated_at).toLocaleDateString())).toBeInTheDocument();
  });

  it('puts the extra columns between the title and the date modified', () => {
    renderRow(
      <DataSourceItemRow item={item} title="A tidy document">
        <td>An extra column</td>
      </DataSourceItemRow>
    );

    const cells = screen.getAllByRole('cell').map(cell => cell.textContent);
    const title = cells.findIndex(text => text?.includes('A tidy document'));
    const extra = cells.indexOf('An extra column');
    const date = cells.indexOf(new Date(item.updated_at).toLocaleDateString());
    expect(title).toBeLessThan(extra);
    expect(extra).toBeLessThan(date);
  });

  it('previews the item when its title or date is clicked', () => {
    const onPreview = vi.fn();
    renderRow(<DataSourceItemRow item={item} title="A tidy document" onPreview={onPreview} />);

    fireEvent.click(screen.getByText('A tidy document'));
    fireEvent.click(screen.getByText(new Date(item.updated_at).toLocaleDateString()));

    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenCalledWith(item);
  });

  it('only offers the priority toggle when it can be changed', () => {
    const onTogglePriorityTier = vi.fn();
    const { unmount } = renderRow(<DataSourceItemRow item={item} title="A tidy document" />);
    expect(screen.queryByRole('button', { name: /Mark this item as important/ })).not.toBeInTheDocument();
    unmount();

    renderRow(<DataSourceItemRow item={item} title="A tidy document" onTogglePriorityTier={onTogglePriorityTier} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark this item as important/ }));
    expect(onTogglePriorityTier).toHaveBeenCalledWith(item);
  });

  it('only offers a retry for an item that failed', () => {
    const onRetry = vi.fn();
    const { unmount } = renderRow(<DataSourceItemRow item={item} title="A tidy document" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Retry processing for this item' })).not.toBeInTheDocument();
    unmount();

    const failed = { ...item, sync_status: 'error' as const };
    renderRow(<DataSourceItemRow item={failed} title="A tidy document" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry processing for this item' }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });

  it('passes the actions of its own type on to the menu', () => {
    const onDelete = vi.fn();
    renderRow(<DataSourceItemRow item={item} title="A tidy document" menuProps={{ onDelete }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onDelete).toHaveBeenCalledWith(item);
  });
});

describe('DataSourceItemRow topics', () => {
  // id is the topic item's, topic_id the topic's, which the list is filtered by
  const topics = [{ id: 99, topic_id: 12, name: 'Elections' }];

  it('filters the list by just the topic clicked, keeping the other filters', () => {
    const onPreview = vi.fn();
    renderRow(
      <DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} topics={topics} onPreview={onPreview} />,
      '/?topics=3,4&topics_mode=exclude&status=paused',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Elections' }));

    const params = new URLSearchParams(screen.getByRole('status').textContent ?? '');
    expect(params.get('topics')).toBe('12');
    expect(params.has('topics_mode')).toBe(false);
    expect(params.get('status')).toBe('paused');
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('filters the list by the items with no topics', () => {
    const onPreview = vi.fn();
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} onPreview={onPreview} />);

    fireEvent.click(screen.getByRole('button', { name: 'Untagged' }));

    expect(new URLSearchParams(screen.getByRole('status').textContent ?? '').get('topics')).toBe('none');
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe('DataSourceItemRow active topics', () => {
  const topics = [{ id: 99, topic_id: 12, name: 'Elections' }];
  const search = () => new URLSearchParams(screen.getByRole('status').textContent ?? '');

  it('stops filtering by a topic the list is filtered by, keeping the others', () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} topics={topics} />, '/?topics=12,5');

    const chip = screen.getByRole('button', { name: 'Filter by Elections' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);

    expect(search().get('topics')).toBe('5');
  });

  it('drops the topics filter with its last topic', () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} topics={topics} />, '/?topics=12');

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Elections' }));

    expect(search().has('topics')).toBe(false);
  });

  it('does not mark the topics of a "none of" filter', () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} topics={topics} />, '/?topics=12&topics_mode=exclude');

    expect(screen.getByRole('button', { name: 'Filter by Elections' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('stops filtering by the items with no topics', () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} />, '/?topics=none');

    const noTopics = screen.getByRole('button', { name: 'Untagged' });
    expect(noTopics).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(noTopics);

    expect(search().has('topics')).toBe(false);
  });
});

describe('DataSourceItemRow compact topics', () => {
  const topics = [{ id: 99, topic_id: 12, name: 'Elections' }, { id: 100, topic_id: 5, name: 'Health' }];
  // The open popover is modal, so it hides the rest of the page from assistive technology
  const search = () => new URLSearchParams(screen.getByRole('status', { hidden: true }).textContent ?? '');

  it('counts the topics in a column, and lists them in a popover that filters the list', async () => {
    const onPreview = vi.fn();
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="compact" columnCount={5} topics={topics} onPreview={onPreview} />, '/?topics=5');

    expect(screen.queryByRole('button', { name: 'Filter by Elections' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 topics' }));

    expect(await screen.findByRole('button', { name: 'Filter by Health' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by Elections' }));

    expect(search().get('topics')).toBe('12');
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('offers to filter by the items with no topics when it has none', async () => {
    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="compact" columnCount={5} />);

    const count = screen.getByRole('button', { name: 'No topics' });
    expect(count).toHaveTextContent('0');
    fireEvent.click(count);
    fireEvent.click(await screen.findByRole('button', { name: 'Untagged' }));

    expect(search().get('topics')).toBe('none');
  });

  it('shows no topics column in comfortable density, or for a row without a column count', () => {
    const { unmount } = renderRow(<DataSourceItemRow item={item} title="A tidy document" density="comfortable" columnCount={4} topics={topics} />);
    expect(screen.queryByRole('button', { name: '2 topics' })).not.toBeInTheDocument();
    unmount();

    renderRow(<DataSourceItemRow item={item} title="A tidy document" density="compact" topics={topics} />);
    expect(screen.queryByRole('button', { name: '2 topics' })).not.toBeInTheDocument();
  });
});

describe('DataSourceItemDateCell', () => {
  it('shows a dash when there is no date', () => {
    renderRow(<tr><DataSourceItemDateCell value={null} /></tr>);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
