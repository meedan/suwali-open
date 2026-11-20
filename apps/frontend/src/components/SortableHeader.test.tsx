import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import SortableHeader from './SortableHeader';

const Search = () => <output>{useLocation().search}</output>;

const renderHeader = (search: string, sortKey: 'title' | 'updated_at') =>
  render(
    <IntlProvider locale="en" messages={{}}>
    <MemoryRouter initialEntries={[`/${search}`]}>
      <Search />
      <table>
        <thead>
          <tr>
            <SortableHeader type="document" sortKey={sortKey}>Column</SortableHeader>
          </tr>
        </thead>
      </table>
    </MemoryRouter>
    </IntlProvider>,
  );

describe('SortableHeader', () => {
  it('shows the default sort on the default column', () => {
    renderHeader('', 'updated_at');
    expect(screen.getByRole('columnheader', { name: 'Column' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('shows the direction from the URL', () => {
    renderHeader('?sort_by=title&sort_direction=asc', 'title');
    expect(screen.getByRole('columnheader', { name: 'Column' })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('shows nothing when another column is sorted', () => {
    renderHeader('?sort_by=title&sort_direction=asc', 'updated_at');
    expect(screen.getByRole('columnheader', { name: 'Column' })).not.toHaveAttribute('aria-sort');
  });

  it('flips the direction when the toggle is clicked', () => {
    renderHeader('?sort_by=title&sort_direction=asc', 'title');
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(screen.getByRole('columnheader', { name: /Column/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('status')).toHaveTextContent('sort_direction=desc');
  });

  it('sorts a date column newest first when its button is clicked', () => {
    renderHeader('?sort_by=title&sort_direction=asc', 'updated_at');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by this column' }));
    expect(screen.getByRole('columnheader', { name: /Column/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('status')).toHaveTextContent('sort_by=updated_at');
  });

  it('sorts a text column A to Z when its button is clicked', () => {
    renderHeader('?sort_by=updated_at&sort_direction=desc', 'title');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by this column' }));
    expect(screen.getByRole('columnheader', { name: /Column/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('status')).toHaveTextContent('sort_direction=asc');
  });
});
