import clsx from 'clsx';
import React from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { defaultSortDirection, type Sortable, typeDefault } from '@helpers/sort';

import { type SortKey, useFilterAndSort } from '@hooks/useFilterAndSort';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './SortableHeader.module.css';

const messages = defineMessages({
  sortAscending: {
    id: 'global.sortAscending',
    defaultMessage: 'Sort ascending',
    description: 'Reusable label for a button that changes the sort direction of a table column to ascending',
  },
  sortDescending: {
    id: 'global.sortDescending',
    defaultMessage: 'Sort descending',
    description: 'Reusable label for a button that changes the sort direction of a table column to descending',
  },
  sortByColumn: {
    id: 'global.sortByColumn',
    defaultMessage: 'Sort by this column',
    description: 'Reusable label for a button in a table column header that sorts the table by that column',
  },
});

type SortableHeaderProps = React.PropsWithChildren<{
  className?: string;
  sortKey: SortKey;
  type: Sortable;
}>;

// Column header with a sort button: always visible on the column the list is sorted by, where it flips
// the direction, and on hover or focus elsewhere, where it sorts by the column. Must use the same defaults
// as the SortModal of the list, so the unsorted state reads as the default sort.
const SortableHeader = ({ children, className, sortKey, type }: SortableHeaderProps) => {
  const intl = useIntl();
  const { currentQuery, updateFilter } = useFilterAndSort({ sort_by: typeDefault[type], sort_direction: 'desc' });
  const isSorted = currentQuery.sort_by === sortKey;
  // An unsorted column's button shows the direction it will apply, which is that column's own default
  const currentDirection = isSorted
    ? (currentQuery.sort_direction === 'asc' ? 'asc' : 'desc')
    : defaultSortDirection(sortKey);
  const nextDirection = currentDirection === 'asc' ? 'desc' : 'asc';

  const label = isSorted
    ? messages[nextDirection === 'asc' ? 'sortAscending' : 'sortDescending']
    : messages.sortByColumn;

  return (
    <th
      scope="col"
      className={clsx(styles.sortable, !isSorted && styles.unsorted, className)}
      aria-sort={isSorted ? (currentDirection === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {children}
      <Button
        aria-label={intl.formatMessage(label)}
        className={styles.sortButton}
        iconLeft={<Icon aria-hidden id={currentDirection === 'asc' ? 'arrow_up' : 'arrow_down'} />}
        size="small"
        themeMode
        variant="text"
        onClick={() => updateFilter({ sort_by: sortKey, sort_direction: isSorted ? nextDirection : currentDirection })}
      />
    </th>
  );
};

export default SortableHeader;
