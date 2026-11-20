import { type ReactElement, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { defaultSortDirection, type Sortable, typeDefault } from '@helpers/sort';

import { type SortKey, useFilterAndSort } from '@hooks/useFilterAndSort';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './SortModal.module.css';

const sortKeyLabels: Record<SortKey, ReactElement> = {
  title: (
    <FormattedMessage
      id="global.name"
      defaultMessage="Name"
      description="Reusable label for item name"
    />
  ),
  content: (
    <FormattedMessage
      id="global.contributionMessage"
      defaultMessage="Contribution"
      description="Label that represents a contribution message"
    />
  ),
  updated_at: (
    <FormattedMessage
      id="global.dateModified"
      defaultMessage="Date modified"
      description="Reusable label for the date the item was last modified"
    />
  ),
  published_at: (
    <FormattedMessage
      id="global.datePublished"
      defaultMessage="Date published"
      description="Reusable label for the date the item was last published"
    />
  ),
  last_summary_updated_by_id: (
    <FormattedMessage
      id="global.lastEditedBy"
      defaultMessage="Last edited by"
      description="Label for the Last Edited by column/sort"
    />
  ),
  user: (
    <FormattedMessage
      id="global.endUser"
      defaultMessage="End-user"
      description="End-users are members of the audience who interact with the chatbot"
    />
  ),
  platform: (
    <FormattedMessage
      id="global.platform"
      defaultMessage="Platform"
      description="Reusable label for the platform the conversation is from"
    />
  ),
  last_message: (
    <FormattedMessage
      id="global.lastMessage"
      defaultMessage="Latest message"
      description="Label for the last message column/sort"
    />
  ),
  messages_count: (
    <FormattedMessage
      id="global.numberOfMessages"
      defaultMessage="Number of messages"
      description="Sort option that orders conversations by how many messages they contain, counting both the person’s messages and the chatbot’s replies"
    />
  ),
  sync_status: (
    <FormattedMessage
      id="global.processingStatus"
      defaultMessage="Processing status"
      description="Label for the processing status sort option"
    />
  ),
  priority_tier: (
    <FormattedMessage
      id="global.priorityTier"
      defaultMessage="Priority tier"
      description="Label for the priority tier"
    />
  ),
};

const typeOptions: Record<Sortable, SortKey[]> = {
  contribution: ['content', 'updated_at', 'user', 'platform', 'sync_status', 'priority_tier'],
  document: ['title', 'updated_at', 'sync_status', 'priority_tier'],
  summary: ['title', 'updated_at', 'published_at', 'last_summary_updated_by_id', 'sync_status', 'priority_tier'],
  conversation: ['user', 'platform', 'last_message', 'messages_count'],
};

// Direction reads better in the field's own terms where it has them. Fields sorted by an id rather
// than a name, such as user, keep the generic labels, since "A to Z" would not be true of them.
const directionLabels = {
  count: {
    asc: (
      <FormattedMessage
        id="global.sortFewestFirst"
        defaultMessage="Fewest first"
        description="Sort direction option that puts the items with the lowest count, such as the fewest messages, first"
      />
    ),
    desc: (
      <FormattedMessage
        id="global.sortMostFirst"
        defaultMessage="Most first"
        description="Sort direction option that puts the items with the highest count, such as the most messages, first"
      />
    ),
  },
  date: {
    asc: (
      <FormattedMessage
        id="global.sortOldestFirst"
        defaultMessage="Oldest first"
        description="Sort direction option that puts the items with the earliest date first"
      />
    ),
    desc: (
      <FormattedMessage
        id="global.sortNewestFirst"
        defaultMessage="Newest first"
        description="Sort direction option that puts the items with the most recent date first"
      />
    ),
  },
  other: {
    asc: (
      <FormattedMessage
        id="global.ascending"
        defaultMessage="Ascending"
        description="Select option for ascending sort order"
      />
    ),
    desc: (
      <FormattedMessage
        id="global.descending"
        defaultMessage="Descending"
        description="Select option for descending sort order"
      />
    ),
  },
};

const sortKeyKinds: Partial<Record<SortKey, keyof typeof directionLabels>> = {
  last_message: 'date',
  messages_count: 'count',
  published_at: 'date',
  updated_at: 'date',
};

const dialogTitles: Record<Sortable, ReactElement> = {
  contribution: (
    <FormattedMessage
      id="global.sortContributionsBy"
      defaultMessage="Sort contributions by"
      description="Title for the sort contributions by modal"
    />
  ),
  document: (
    <FormattedMessage
      id="global.sortDocumentsBy"
      defaultMessage="Sort documents by"
      description="Title for the sort documents by modal"
    />
  ),
  summary: (
    <FormattedMessage
      id="global.sortSummariesBy"
      defaultMessage="Sort summaries by"
      description="Title for the sort summaries by modal"
    />
  ),
  conversation: (
    <FormattedMessage
      id="global.sortConversationsBy"
      defaultMessage="Sort conversations by"
      description="Title for the sort conversations by modal"
    />
  ),
};

// Also doubles as the compact trigger button's accessible label, since its visual label may be
// just the icon, or the generic word "Sort" — neither identifies which list it sorts on its own
const tooltipMessages = defineMessages({
  contribution: {
    id: 'global.sortContributions',
    defaultMessage: 'Sort contributions',
    description: 'Tooltip for the sort contributions by modal',
  },
  document: {
    id: 'global.sortDocuments',
    defaultMessage: 'Sort documents',
    description: 'Tooltip for the sort documents by modal',
  },
  summary: {
    id: 'global.sortSummaries',
    defaultMessage: 'Sort summaries',
    description: 'Tooltip for the sort summaries by modal',
  },
  conversation: {
    id: 'global.sortConversations',
    defaultMessage: 'Sort conversations',
    description: 'Tooltip for the sort conversations by modal',
  },
});

const tooltipTitles: Record<Sortable, ReactElement> = {
  contribution: <FormattedMessage {...tooltipMessages.contribution} />,
  document: <FormattedMessage {...tooltipMessages.document} />,
  summary: <FormattedMessage {...tooltipMessages.summary} />,
  conversation: <FormattedMessage {...tooltipMessages.conversation} />,
};

const buildSortOptions = (keys: SortKey[], labels: Partial<Record<SortKey, ReactElement>>) => keys.map(key => (
  <SelectItem key={key} value={key}>
    {labels[key] ?? sortKeyLabels[key]}
  </SelectItem>
));

type SortModalProps = {
  // Renames fields whose default label does not fit the list, such as who a conversation is with
  labels?: Partial<Record<SortKey, ReactElement>>;
  // Narrows the fields offered for the type, for lists where some of them don't vary
  options?: SortKey[];
  type: Sortable;
  // Spells out "Sort" alongside the icon; off for compact toolbars where the icon alone reads fine
  verboseButton?: boolean;
};

export const SortModal = ({ labels = {}, options, type, verboseButton = true }: SortModalProps) => {
  const intl = useIntl();
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    stateQuery,
    setFilter,
    applySort,
    resetSort,
    discardChanges,
    isSortActive,
  } = useFilterAndSort({
    sort_by: typeDefault[type],
    sort_direction: 'desc',
  });

  const { sort_by: sortBy, sort_direction: sortDirection } = stateQuery;
  const sortDirectionLabels = directionLabels[(sortBy && sortKeyKinds[sortBy]) || 'other'];

  // Sorting can also change from a column header, so start from what is applied now
  const onOpenChange = (open: boolean) => {
    if (open) discardChanges();
    setDialogOpen(open);
  };

  const onCancel = () => {
    discardChanges();
    setDialogOpen(false);
  };

  const onConfirm = () => {
    applySort();
    setDialogOpen(false);
  };

  const onReset = () => {
    resetSort();
    setDialogOpen(false);
  };

  return (
    <>
      <Modal
        open={dialogOpen}
        onOpenChange={onOpenChange}
        actions={
          <div className={styles.actionsRow}>
            <Button
              label={
                <FormattedMessage
                  id="global.resetToDefault"
                  defaultMessage="Reset to default"
                  description="Button label to reset filters to their default values"
                />
              }
              size="small"
              themeMode
              variant="text"
              onClick={onReset}
            />
            <div className={styles.mainActions}>
              <Button
                label={
                  <FormattedMessage
                    id="global.cancel"
                    defaultMessage="Cancel"
                    description="Reusable label for cancel buttons"
                  />
                }
                size="small"
                themeMode
                variant="text"
                onClick={onCancel}
              />
              <Button
                label={
                  <FormattedMessage
                    id="global.updateSorting"
                    defaultMessage="Update sorting"
                    description="Update sorting button label"
                  />
                }
                size="small"
                onClick={onConfirm}
              />
            </div>
          </div>
        }
        body={
          <div className={styles.modalBody}>
            {/* Sort by */}
            <div className={styles.sortRow}>
              <div className={styles.sortLabel}>
                <FormattedMessage
                  id="global.sortBy"
                  defaultMessage="Sort by"
                  description="Label for sort by"
                />
              </div>
              <div>
                <Select
                  size="small"
                  value={sortBy}
                  onValueChange={(value: string) => {
                    setFilter('sort_by', value as SortKey);
                    setFilter('sort_direction', defaultSortDirection(value as SortKey));
                  }}
                >
                  {buildSortOptions(options ?? typeOptions[type], labels)}
                </Select>
              </div>
            </div>
            {/* Sort direction */}
            <div className={styles.sortRow}>
              <div className={styles.sortLabel}>
                <FormattedMessage
                  id="global.sortDirection"
                  defaultMessage="Sort direction"
                  description="Label for sort direction"
                />
              </div>
              <div>
                <ToggleGroup
                  size="small"
                  type="single"
                  value={sortDirection}
                  onValueChange={(value: 'asc' | 'desc') => setFilter('sort_direction', value)}
                >
                  <ToggleGroupItem value="asc">
                    <Icon aria-hidden id="sort_descending" />
                    {sortDirectionLabels.asc}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="desc">
                    <Icon aria-hidden id="sort_ascending" />
                    {sortDirectionLabels.desc}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        }
        title={dialogTitles[type]}
        trigger={
          <Tooltip content={tooltipTitles[type]}>
            <Button
              // The compact icon-only trigger isn't an accessible name on its own — the verbose
              // "Sort" label already spells this out visibly, so it needs no override
              aria-label={verboseButton ? undefined : intl.formatMessage(tooltipMessages[type])}
              variant="filled"
              size="small"
              iconLeft={
                <Icon aria-hidden id={sortDirection === 'asc' ? 'sort_descending' : 'sort_ascending'} />
              }
              label={
                verboseButton &&
                <FormattedMessage
                  id="global.sort"
                  defaultMessage="Sort"
                  description="Button label for changing sort rules for a list or table"
                />
              }
              themeMode={!isSortActive}
            />
          </Tooltip>
        }
      />
    </>
  );
};
