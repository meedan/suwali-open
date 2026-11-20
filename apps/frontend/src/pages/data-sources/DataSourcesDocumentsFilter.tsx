import { useMemo } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { User } from '@customTypes/user';

import { fetchHubEditors } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { type DocumentsFilter, useFilterAndSort } from '@hooks/useFilterAndSort';
import { useSignalEnabled } from '@hooks/useSignalEnabled';

import { Select, SelectItem } from '@ui-components/input/SelectInput';
import Avatar from '@ui-components/layout/Avatar';

import styles from './DataSourcesDocumentsFilter.module.css';
import { CheckboxFilter, DateSelect, FilterRow, ToggleFilter } from './FilterFields';
import { FilterModal } from './FilterModal';
import { getDefaultLists, type SyncStatus, syncStatusMessages } from './filterOptions';
import TopicsFilter from './TopicsFilter';


const messages = defineMessages({
  filterDocumentsBy: {
    id: 'global.filterDocumentsBy',
    defaultMessage: 'Filter documents by',
    description: 'Filter dialog title',
  },
  filterContributionsBy: {
    id: 'global.filterContributionsBy',
    defaultMessage: 'Filter contributions by',
    description: 'Filter dialog title',
  },
  filterSummariesBy: {
    id: 'global.filterSummariesBy',
    defaultMessage: 'Filter summaries by',
    description: 'Filter dialog title',
  },
});

type DataSourcesDocumentsFilterProps = (
  | {
      type: 'contribution';
      connectedPlatforms: Array<'whatsapp' | 'telegram' | 'sms' | 'signal' | 'internal'>;
    }
  | {
      type: 'document';
      sourceId: number;
      showDatePublished?: boolean;
    }
  | {
      type: 'summary';
    }
) & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const DataSourcesDocumentsFilter = (props: DataSourcesDocumentsFilterProps) => {
  const { type } = props;
  const connectedPlatforms = props.type === 'contribution' ? props.connectedPlatforms : undefined;
  const showDatePublished = type === 'summary' || (props.type === 'document' && props.showDatePublished);
  const sourceId = props.type === 'document' ? props.sourceId : undefined;
  const topicsItemType = { document: 'Document', contribution: 'Contribution', summary: 'Notebook' }[type] as 'Document' | 'Contribution' | 'Notebook';
  const intl = useIntl();

  const defaultLists = getDefaultLists(type, connectedPlatforms);
  const hubId = useSession().currentHubId();
  const signalEnabled = useSignalEnabled();

  const {
    stateQuery,
    setFilter,
    applyFilter,
    resetFilter,
    discardChanges,
    activeFiltersCount,
  } = useFilterAndSort({}, defaultLists);

  const {
    status,
    notebooks,
    published_by: publishedBy,
    date_modified: dateModified,
    date_published: datePublished,
    platforms,
    participants,
    sync_status: syncStatus,
    priority_tier: priorityTier,
    topics,
    topics_mode: topicsMode,
  } = stateQuery;

  const { data } = useQuery({
    queryKey: [`/hubs/${hubId}/memberships`],
    queryFn: () => fetchHubEditors(hubId!),
    enabled: Boolean(hubId) && type === 'summary',
  });

  const team = useMemo(() => data || [], [data]);

  const onApply = () => {
    applyFilter(stateQuery.topics ? undefined : { topics_mode: undefined });
  };

  const dialogTitle = ({
    contribution: intl.formatMessage(messages.filterContributionsBy),
    document: intl.formatMessage(messages.filterDocumentsBy),
    summary: intl.formatMessage(messages.filterSummariesBy),
  } as Record<string, string>)[type];

  return (
    <FilterModal
      title={dialogTitle}
      activeFiltersCount={activeFiltersCount}
      onApply={onApply}
      onReset={resetFilter}
      onDiscard={discardChanges}
      open={props.open}
      onOpenChange={props.onOpenChange}
      verboseButton
    >
      <FilterRow
        fill
        label={
          <FormattedMessage
            id="global.dateModified"
            defaultMessage="Date modified"
            description="Reusable label for the date the item was last modified"
          />
        }
      >
        <DateSelect value={dateModified} onChange={value => setFilter('date_modified', value)} />
      </FilterRow>
      {showDatePublished && (
        <FilterRow
          fill
          label={
            <FormattedMessage
              id="global.datePublished"
              defaultMessage="Date published"
              description="Reusable label for the date the item was last published"
            />
          }
        >
          <DateSelect value={datePublished} onChange={value => setFilter('date_published', value)} />
        </FilterRow>
      )}
      {type === 'summary' && (
        <FilterRow
          fill
          label={
            <FormattedMessage
              id="global.publishedBy"
              defaultMessage="Published by"
              description="Reusable label for notebook summary published by"
            />
          }
        >
          <Select
            size="small"
            multiple
            value={publishedBy || ''}
            onValueChange={(value: string) => setFilter('published_by', value)}
            placeholder={intl.formatMessage({
              id: 'global.anyTeamMember',
              defaultMessage: 'Any team member',
              description: 'Label for any team member'
            })}
            multipleLabel={(count) => intl.formatMessage({
              id: 'global.teamSelected',
              defaultMessage: '{count} {count, plural, one {team member} other {team members}} selected',
              description: 'Label showing count of selected team members'
            }, { count })}
          >
            {team.map(({ user: editor }: { user: User }) => (
              <SelectItem
                key={editor.id}
                value={editor.id.toString()}
              >
                <div className={styles.teamSelectItem}>
                  <Avatar
                    className={styles.editorAvatar}
                    name={editor.name}
                    picture={editor.profile_picture_url}
                    fallback={editor?.email.substring(0, 1)}
                  />
                  {editor.name || editor.email}
                </div>
              </SelectItem>
            ))}
          </Select>
        </FilterRow>
      )}
      {type === 'contribution' && (
        <FilterRow
          fill
          label={
            <FormattedMessage
              id="conversationsFilter.conversationsWith"
              defaultMessage="Conversations with"
              description="Label for conversations with filter"
            />
          }
        >
          <CheckboxFilter
            value={participants}
            onChange={value => setFilter('participants', value)}
            options={[
              {
                value: 'anonymous',
                label: (
                  <FormattedMessage
                    id="global.anonymousEndUsers"
                    defaultMessage="Anonymous end-users"
                    description="Reusable label for anonymous end-users"
                  />
                ),
              },
              {
                value: 'trusted',
                label: (
                  <FormattedMessage
                    id="global.trustedEndUsers"
                    defaultMessage="Trusted end-users"
                    description="Reusable label for trusted end-users"
                  />
                ),
              },
            ]}
          />
        </FilterRow>
      )}
      {type === 'contribution' && (
        <FilterRow
          fill
          label={
            <FormattedMessage
              id="global.platform"
              defaultMessage="Platform"
              description="Reusable label for the platform the conversation is from"
            />
          }
        >
          <CheckboxFilter
            value={platforms}
            defaultSelected={defaultLists.platforms}
            onChange={value => setFilter('platforms', value)}
            options={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'telegram', label: 'Telegram' },
              { value: 'sms', label: 'SMS' },
              ...(signalEnabled ? [{ value: 'signal', label: 'Signal' }] : []),
            ]}
          />
        </FilterRow>
      )}
      <FilterRow
        label={
          <FormattedMessage
            id="global.documentStatus"
            defaultMessage="Status"
            description="Label for document status filter"
          />
        }
      >
        <ToggleFilter
          value={status || 'all'}
          onChange={value => setFilter('status', value as DocumentsFilter['status'])}
          options={[
            {
              value: 'all',
              label: (
                <FormattedMessage
                  id="global.documentStatusAll"
                  defaultMessage="All"
                  description="Label for filter option to show all documents regardless of their status"
                />
              ),
            },
            {
              value: 'paused',
              label: (
                <FormattedMessage
                  id="global.documentStatusPaused"
                  defaultMessage="Paused"
                  description="Label for filter option to show paused documents only"
                />
              ),
            },
            {
              value: 'active',
              label: (
                <FormattedMessage
                  id="global.documentStatusActive"
                  defaultMessage="Active"
                  description="Label for filter option to show active documents only"
                />
              ),
            },
          ]}
        />
      </FilterRow>
      <FilterRow
        label={
          <FormattedMessage
            id="global.priorityTier"
            defaultMessage="Priority tier"
            description="Label for the priority tier"
          />
        }
      >
        <ToggleFilter
          value={priorityTier || 'all'}
          onChange={value => setFilter('priority_tier', value as DocumentsFilter['priority_tier'])}
          options={[
            {
              value: 'all',
              label: (
                <FormattedMessage
                  id="dataSourcesItemFilterBy.allPriorityStatus"
                  defaultMessage="All"
                  description="Label for filter option to show all documents regardless of their priority"
                />
              ),
            },
            {
              value: '1',
              label: (
                <FormattedMessage
                  id="global.default"
                  defaultMessage="Default"
                  description="Label or title for a default status of an item or selection"
                />
              ),
            },
            {
              value: '2',
              label: (
                <FormattedMessage
                  id="dataSourcesItemFilterBy.importantPriorityStatus"
                  defaultMessage="Important"
                  description="Label for filter option to show all documents marked as important priority"
                />
              ),
            },
          ]}
        />
      </FilterRow>
      <FilterRow
        fill
        label={
          <FormattedMessage
            id="global.processingFilter"
            defaultMessage="Processing"
            description="Label for processing status filter"
          />
        }
      >
        <CheckboxFilter
          value={syncStatus}
          onChange={value => setFilter('sync_status', value)}
          options={defaultLists.sync_status.map(status => ({
            value: status,
            label: <FormattedMessage {...syncStatusMessages[status as SyncStatus]} />,
          }))}
        />
      </FilterRow>
      {type !== 'summary' && (
        <FilterRow
          label={
            <FormattedMessage
              id="global.notebooks"
              defaultMessage="Notebooks"
              description="Reusable label for Notebooks page or list title"
            />
          }
        >
          <ToggleFilter
            value={notebooks || 'all'}
            onChange={value => setFilter('notebooks', value as DocumentsFilter['notebooks'])}
            options={[
              {
                value: 'all',
                label: (
                  <FormattedMessage
                    id="global.documentStatusAll"
                    defaultMessage="All"
                    description="Label for filter option to show all documents regardless of their status"
                  />
                ),
              },
              {
                value: 'true',
                label: (
                  <FormattedMessage
                    id="global.documentInNotebooks"
                    defaultMessage="In notebooks"
                    description="Label for filter option to show only documents that are in notebooks"
                  />
                ),
              },
              {
                value: 'false',
                label: (
                  <FormattedMessage
                    id="global.documentNotInNotebooks"
                    defaultMessage="Not in notebooks"
                    description="Label for filter option to show only documents that are not in notebooks"
                  />
                ),
              },
            ]}
          />
        </FilterRow>
      )}
      <FilterRow
        fill
        label={
          <FormattedMessage
            id="global.topics"
            defaultMessage="Topics"
            description="Label for the topics from a message or document"
          />
        }
      >
        <TopicsFilter
          itemType={topicsItemType}
          sourceId={sourceId}
          topics={topics}
          mode={topicsMode}
          onTopicsChange={value => setFilter('topics', value)}
          onModeChange={value => setFilter('topics_mode', value)}
        />
      </FilterRow>
    </FilterModal>
  );
};
