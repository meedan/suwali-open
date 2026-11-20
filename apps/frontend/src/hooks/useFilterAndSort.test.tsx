import { MemoryRouter, useSearchParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { type DocumentsFilter, useFilterAndSort } from './useFilterAndSort';

const TestComponent = ({
  defaultQuery = {},
  filterKey,
  filterValue,
}: {
  defaultQuery?: DocumentsFilter;
  filterKey?: keyof DocumentsFilter;
  filterValue?: string;
}) => {
  const hook = useFilterAndSort(defaultQuery);
  const [params] = useSearchParams();

  return (
    <>
      <span data-testid="params">{params.toString()}</span>
      <span data-testid="count">{hook.activeFiltersCount}</span>
      {filterKey && (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <button onClick={() => hook.setFilter(filterKey, filterValue as any)}>set</button>
      )}
      <button onClick={() => hook.applyFilter()}>apply filter</button>
      <button onClick={() => hook.updateFilter({ status: undefined })}>stop status</button>
      <button onClick={() => hook.applySort()}>apply sort</button>
      <button onClick={() => hook.resetFilter()}>reset filter</button>
      <button onClick={() => hook.resetSort()}>reset sort</button>
    </>
  );
};

describe('useFilterAndSort', () => {
  describe('updateFilter', () => {
    it('changes what is applied, and drops what was chosen but not applied', () => {
      render(
        <MemoryRouter initialEntries={['/?status=active&sort_by=title']}>
          <TestComponent filterKey="notebooks" filterValue="true" />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByText('set'));
      fireEvent.click(screen.getByText('stop status'));
      expect(screen.getByTestId('params')).toHaveTextContent('sort_by=title');

      // Neither the status stopped nor the notebooks filter that was never confirmed is applied by the next confirm
      fireEvent.click(screen.getByText('apply filter'));
      expect(screen.getByTestId('params').textContent).toBe('sort_by=title');
    });
  });

  describe('applyFilter', () => {
    it.each([
      ['status', 'active'],
      ['notebooks', 'true'],
      ['date_modified', 'today'],
      ['date_published', 'yesterday'],
      ['sync_status', 'complete'],
      ['priority_tier', '2'],
      ['published_by', '42'],
      ['last_message', 'today'],
      ['first_message', 'today'],
      ['participants', '5'],
      ['has_message', 'true'],
    ] as [keyof DocumentsFilter, string][])('writes %s to URL params', (key, value) => {
      render(
        <MemoryRouter>
          <TestComponent filterKey={key} filterValue={value} />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'set' }));
      fireEvent.click(screen.getByRole('button', { name: 'apply filter' }));
      expect(decodeURIComponent(screen.getByTestId('params').textContent!)).toContain(`${key}=${value}`);
    });

    it('writes comma-joined platforms to URL params', () => {
      render(
        <MemoryRouter>
          <TestComponent filterKey="platforms" filterValue="whatsapp,telegram" />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'set' }));
      fireEvent.click(screen.getByRole('button', { name: 'apply filter' }));
      expect(decodeURIComponent(screen.getByTestId('params').textContent!)).toContain('platforms=whatsapp,telegram');
    });

    it('does not write sort keys to URL params', () => {
      render(
        <MemoryRouter>
          <TestComponent filterKey="sort_by" filterValue="updated_at" />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'set' }));
      fireEvent.click(screen.getByRole('button', { name: 'apply filter' }));
      expect(screen.getByTestId('params').textContent).not.toContain('sort_by=');
    });
  });

  describe('applySort', () => {
    it('writes sort_by and sort_direction to URL params', () => {
      render(
        <MemoryRouter>
          <TestComponent defaultQuery={{ sort_by: 'updated_at', sort_direction: 'asc' }} />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'apply sort' }));
      const params = decodeURIComponent(screen.getByTestId('params').textContent!);
      expect(params).toContain('sort_by=updated_at');
      expect(params).toContain('sort_direction=asc');
    });

    it('accepts priority_tier as sort_by', () => {
      render(
        <MemoryRouter>
          <TestComponent defaultQuery={{ sort_by: 'priority_tier', sort_direction: 'desc' }} />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'apply sort' }));
      const params = decodeURIComponent(screen.getByTestId('params').textContent!);
      expect(params).toContain('sort_by=priority_tier');
      expect(params).toContain('sort_direction=desc');
    });
  });

  describe('resetFilter', () => {
    it('clears filter params but preserves sort', () => {
      render(
        <MemoryRouter initialEntries={['/?status=active&priority_tier=2&sort_by=updated_at']}>
          <TestComponent />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'reset filter' }));
      const params = decodeURIComponent(screen.getByTestId('params').textContent!);
      expect(params).not.toContain('status=');
      expect(params).not.toContain('priority_tier=');
      expect(params).toContain('sort_by=updated_at');
    });
  });

  describe('resetSort', () => {
    it('does not clear priority_tier', () => {
      render(
        <MemoryRouter initialEntries={['/?priority_tier=2&sort_by=updated_at&sort_direction=asc']}>
          <TestComponent />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: 'reset sort' }));
      const params = decodeURIComponent(screen.getByTestId('params').textContent!);
      expect(params).toContain('priority_tier=2');
      expect(params).not.toContain('sort_by=');
    });
  });

  describe('activeFiltersCount', () => {
    it('counts non-sort active filters', () => {
      render(
        <MemoryRouter initialEntries={['/?status=active&priority_tier=2&sort_by=updated_at']}>
          <TestComponent />
        </MemoryRouter>
      );
      expect(screen.getByTestId('count').textContent).toBe('2');
    });

    it('counts the topics as one filter, whatever way they filter', () => {
      render(
        <MemoryRouter initialEntries={['/?topics=3,none&topics_mode=exclude&status=active']}>
          <TestComponent />
        </MemoryRouter>
      );
      expect(screen.getByTestId('count').textContent).toBe('2');
    });

    it('does not count a filter explicitly cleared with any', () => {
      render(
        <MemoryRouter initialEntries={['/?platforms=any&status=active']}>
          <TestComponent />
        </MemoryRouter>
      );
      expect(screen.getByTestId('count').textContent).toBe('1');
    });
  });
});
