import clsx from 'clsx';
import React from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { PriorityTier } from '@customTypes/priority-tier';
import type { ItemTopic } from '@customTypes/topic';

import { splitList } from '@helpers/lists';

import { useFilterAndSort } from '@hooks/useFilterAndSort';
import type { Density } from '@hooks/useTableDensity';

import Button from '@ui-components/input/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@ui-components/layout/Popover';
import listStyles from '@ui-components/layout/PopoverList.module.css';

import DataSourceItemActionsMenu from '@components/DataSourceItemActionsMenu';
import DataSourceItemTitle from '@components/DataSourceItemTitle';
import PriorityTierToggle from '@components/PriorityTierToggle';
import TopicChips from '@components/TopicChips';

import styles from './DataSourcesDocumentsPanel.module.css';
import { UNTAGGED } from './filterOptions';
import { hasTopicsColumn } from './tableColumns';

const messages = defineMessages({
  topicsCount: {
    id: 'dataSourceItemRow.topicsCount',
    defaultMessage: '{count, plural, =0 {No topics} one {# topic} other {# topics}}',
    description: 'Accessible label of the button in a table row that shows how many topics the item has and opens the list of them',
  },
});

export const DataSourceItemTopicsHeader = ({ density }: { density?: Density }) => (hasTopicsColumn(density) && (
  <th scope="col" className={styles.topicsHeader}>
    <FormattedMessage
      id="global.topics"
      defaultMessage="Topics"
      description="Label for the topics from a message or document"
    />
  </th>
));

type DateCellProps = {
  value?: string | null;
  onClick?: () => void;
};

export const DataSourceItemDateCell = ({ value, onClick }: DateCellProps) => (
  <td
    className={clsx('table-date-cell', styles.dateCell, onClick && styles.rowPreview)}
    title={value ? new Date(value).toLocaleString() : undefined}
    onClick={onClick}
  >
    {value ? new Date(value).toLocaleDateString() : <span>—</span>}
  </td>
);

type DataSourceItem = {
  id: number;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  priority_tier: PriorityTier;
  updated_at: string;
};

type DataSourceItemRowProps<T extends DataSourceItem> = React.PropsWithChildren<{
  item: T;
  title: string;
  density?: Density;
  topics?: ItemTopic[];
  // Of the whole table, counting the topics column in compact density; leave it out for a row that shows no topics
  columnCount?: number;
  onPreview?: (item: T) => void;
  onAddToNotebook?: (item: T) => void;
  onPause?: (item: T) => void;
  onRetry?: (item: T) => void;
  onTogglePriorityTier?: (item: T) => void;
  onCopyPermalink?: (item: T) => void;
  menuProps?: {
    onDelete?: (item: T) => void;
    onUnpublish?: (item: T) => void;
    onRefresh?: (item: T) => void;
    conversationId?: string | number;
    downloadUrl?: string | null;
    externalUrl?: string;
  };
}>;

// Renders the priority, title, date modified and actions cells; children are the columns in between.
const DataSourceItemRow = <T extends DataSourceItem>({
  item,
  title,
  density,
  topics = [],
  columnCount = 1,
  children,
  onPreview,
  onAddToNotebook,
  onPause,
  onRetry,
  onTogglePriorityTier,
  onCopyPermalink,
  menuProps,
}: DataSourceItemRowProps<T>) => {
  const intl = useIntl();
  const preview = onPreview && (() => onPreview(item));
  const paused = item.active === false || item.sync_status !== 'complete';
  const comfortable = density === 'comfortable';
  const showTopics = !hasTopicsColumn(density) && columnCount > 1;
  const showTopicsCell = hasTopicsColumn(density) && columnCount > 1;
  const { currentQuery, updateFilter } = useFilterAndSort({});
  // Under "none of", the rows shown have none of the topics filtered by, so there is nothing to mark
  const activeTopics = currentQuery.topics_mode === 'exclude' ? [] : splitList(currentQuery.topics);

  // A topic the list is filtered by stops being one; any other replaces the topics filtered by, and drops "none of"
  const toggleTopic = (token: string) => {
    const topics = activeTopics.includes(token) ? activeTopics.filter(active => active !== token).join(',') : token;
    updateFilter({ topics: topics || undefined, topics_mode: undefined });
  };
  const untaggedActive = activeTopics.includes(UNTAGGED);

  const topicsContent = topics.length > 0 ? (
    <TopicChips topics={topics} onTopicClick={topic => toggleTopic(String(topic.topic_id))} isActive={topic => activeTopics.includes(String(topic.topic_id))} />
  ) : (
    <button
      aria-pressed={untaggedActive}
      className={clsx(styles.noTopics, untaggedActive && styles.noTopicsActive)}
      type="button"
      onClick={event => {
        event.stopPropagation();
        toggleTopic(UNTAGGED);
      }}
    >
      <FormattedMessage
        id="dataSourceItemRow.untagged"
        defaultMessage="Untagged"
        description="Shown in place of the topics of a table row when the item has none, under the row or in the list its topics count opens. Clicking it filters the list to the items that have no topics, or stops that filter"
      />
    </button>
  );

  return (
    <>
      <tr className={clsx({ [styles.rowPaused]: paused, [styles.hasTopicsRow]: showTopics, [styles.rowCompact]: !comfortable, [styles.rowComfortable]: comfortable })}>
        <td className="table-priority-cell">
          {onTogglePriorityTier && (
            <PriorityTierToggle
              disabled={item.sync_status === 'pending'}
              priorityTier={item.priority_tier}
              onToggle={() => onTogglePriorityTier(item)}
              size="small"
              variant="filled"
            />
          )}
        </td>
        <td className={clsx(preview && styles.rowPreview, comfortable && styles.titleComfortable)} onClick={preview}>
          <DataSourceItemTitle title={title} syncStatus={item.sync_status} active={item.active} singleLine={!comfortable} iconOnly={!comfortable} className={paused ? styles.titlePaused : undefined} />
        </td>
        {children}
        {showTopicsCell && (
          <td>
            {/* Modal, so the click outside that closes it doesn’t also open the row’s preview */}
            <Popover modal>
              <PopoverTrigger asChild>
                <Button
                  aria-label={intl.formatMessage(messages.topicsCount, { count: topics.length })}
                  label={intl.formatNumber(topics.length)}
                  size="small"
                  themeMode
                />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className={clsx(listStyles.popover, styles.topicsPopover)}
                // Focusing the first chip would open its tooltip; Tab still reaches it from the popover
                onOpenAutoFocus={event => {
                  event.preventDefault();
                  (event.currentTarget as HTMLElement).focus();
                }}
              >
                {topicsContent}
              </PopoverContent>
            </Popover>
          </td>
        )}
        <DataSourceItemDateCell value={item.updated_at} onClick={preview} />
        <td className="table-row-actions">
          <DataSourceItemActionsMenu
            item={item}
            onPause={onPause}
            onAddToNotebook={onAddToNotebook}
            onRetry={item.sync_status === 'error' ? onRetry : undefined}
            onPreview={onPreview}
            onCopyPermalink={onCopyPermalink}
            onTogglePriorityTier={onTogglePriorityTier}
            priorityTier={onTogglePriorityTier ? item.priority_tier : undefined}
            quickActionsClassName={styles.quickActions}
            {...menuProps}
          />
        </td>
      </tr>
      {showTopics && (
        <tr className={clsx(styles.topicsRow, { [styles.rowPaused]: paused })}>
          <td className={clsx('table-priority-cell', preview && styles.rowPreview)} onClick={preview} />
          <td colSpan={columnCount - 1} className={clsx(preview && styles.rowPreview)} onClick={preview}>
            {topicsContent}
          </td>
        </tr>
      )}
    </>
  );
};

export default DataSourceItemRow;
