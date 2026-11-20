import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { User } from '@customTypes/user';

import { sameItems, splitList } from '@helpers/lists';

import { fetchHubEditors } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { type DocumentsFilter, useFilterAndSort } from '@hooks/useFilterAndSort';
import type { Density } from '@hooks/useTableDensity';
import { useTopicNames } from '@hooks/useTopicNames';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import Chip from '@ui-components/layout/Chip';
import Tooltip from '@ui-components/layout/Tooltip';

import DensityToggle from '@components/DensityToggle';

import styles from './ActiveFilters.module.css';
import { ALL_PARTICIPANTS, dateOptionMessages, getDefaultLists, type SyncStatus, syncStatusMessages, UNTAGGED } from './filterOptions';
import { AnyOf, NoneOf } from './TopicsFilter';

const filterMessages = defineMessages({
  dateModified: {
    id: 'global.dateModified',
    defaultMessage: 'Date modified',
    description: 'Reusable label for the date the item was last modified',
  },
  datePublished: {
    id: 'global.datePublished',
    defaultMessage: 'Date published',
    description: 'Reusable label for the date the item was last published',
  },
  status: {
    id: 'global.documentStatus',
    defaultMessage: 'Status',
    description: 'Label for document status filter',
  },
  priorityTier: {
    id: 'global.priorityTier',
    defaultMessage: 'Priority tier',
    description: 'Label for the priority tier',
  },
  notebooks: {
    id: 'global.notebooks',
    defaultMessage: 'Notebooks',
    description: 'Reusable label for Notebooks page or list title',
  },
  processing: {
    id: 'global.processingFilter',
    defaultMessage: 'Processing',
    description: 'Label for processing status filter',
  },
  platform: {
    id: 'global.platform',
    defaultMessage: 'Platform',
    description: 'Reusable label for the platform the conversation is from',
  },
  participants: {
    id: 'conversationsFilter.conversationsWith',
    defaultMessage: 'Conversations with',
    description: 'Label for conversations with filter',
  },
  publishedBy: {
    id: 'global.publishedBy',
    defaultMessage: 'Published by',
    description: 'Reusable label for notebook summary published by',
  },
});

const valueMessages = defineMessages({
  paused: {
    id: 'global.documentStatusPaused',
    defaultMessage: 'Paused',
    description: 'Label for filter option to show paused documents only',
  },
  active: {
    id: 'global.documentStatusActive',
    defaultMessage: 'Active',
    description: 'Label for filter option to show active documents only',
  },
  default: {
    id: 'global.default',
    defaultMessage: 'Default',
    description: 'Label or title for a default status of an item or selection',
  },
  important: {
    id: 'dataSourcesItemFilterBy.importantPriorityStatus',
    defaultMessage: 'Important',
    description: 'Label for filter option to show all documents marked as important priority',
  },
  inNotebooks: {
    id: 'global.documentInNotebooks',
    defaultMessage: 'In notebooks',
    description: 'Label for filter option to show only documents that are in notebooks',
  },
  notInNotebooks: {
    id: 'global.documentNotInNotebooks',
    defaultMessage: 'Not in notebooks',
    description: 'Label for filter option to show only documents that are not in notebooks',
  },
  anonymous: {
    id: 'global.anonymousEndUsers',
    defaultMessage: 'Anonymous end-users',
    description: 'Reusable label for anonymous end-users',
  },
  trusted: {
    id: 'global.trustedEndUsers',
    defaultMessage: 'Trusted end-users',
    description: 'Reusable label for trusted end-users',
  },
  untagged: {
    id: 'topicsFilter.untagged',
    defaultMessage: 'Untagged',
    description: 'Option of the topics to filter a list by, for the items that have no topics',
  },
  teamSelected: {
    id: 'global.teamSelected',
    defaultMessage: '{count} {count, plural, one {team member} other {team members}} selected',
    description: 'Label showing count of selected team members',
  },
});

const messages = defineMessages({
  filter: {
    id: 'global.filter',
    defaultMessage: 'Filter',
    description: 'Button label to open the filter dialog',
  },
  clearAllFilters: {
    id: 'activeFilters.clearAllFilters',
    defaultMessage: 'Clear all filters',
    description: 'Accessible label of the button that stops a list being filtered by anything, for when it is read apart from what it is filtered by',
  },
  removeFilter: {
    id: 'activeFilters.removeFilter',
    defaultMessage: 'Remove the {filter} filter',
    description: 'Accessible label of the button that stops a list being filtered by one thing, such as its date or status. Example: Remove the Date modified filter',
  },
  unknownTopic: {
    id: 'topicsFilter.unknown',
    defaultMessage: 'Unknown topic',
    description: 'Label of a topic a list of data source items is filtered by, that no longer exists, such as one deleted since a link to the list was made',
  },
  topicsModeLabel: {
    id: 'topicsFilter.modeLabel',
    defaultMessage: 'Show items with any or none of the topics',
    description: 'Accessible label of the select, beside the topics a list of data source items is filtered by, that sets whether the list shows the items with any of those topics or all but them',
  },
  removeTopic: {
    id: 'topicsFilter.remove',
    defaultMessage: 'Remove {name} from the filter',
    description: 'Accessible label of the button that stops a list of data source items being filtered by a topic. Example: Remove Climate from the filter',
  },
});

type Platform = 'whatsapp' | 'telegram' | 'sms' | 'signal' | 'internal';

type ActiveFiltersProps = (
  | {
      type: 'contribution';
      connectedPlatforms: Platform[];
    }
  | {
      type: 'document';
      // The data source whose documents are listed, whose items the topics filtered by are of
      sourceId: number;
    }
  | {
      type: 'summary';
    }
) & {
  density: Density;
  onDensityChange: (density: Density) => void;
  // Opens the dialog the filters are changed in, as clicking a chip does
  onEdit: () => void;
  // How many items the filters leave, said first in the row, and how many there are without them. Left out until known
  resultCount?: number;
  totalCount?: number;
};

const PLATFORM_NAMES: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS', signal: 'Signal' };

const TOPICS_ITEM_TYPE = { document: 'Document', contribution: 'Contribution', summary: 'Notebook' } as const;

// The row above a list: what it is filtered by, one chip each, to see it without opening the dialog and to stop it from
// there, then how many items that leaves and how densely they are shown. With no filter, the header's filter button is the one shown.
const ActiveFilters = (props: ActiveFiltersProps) => {
  const { type, onEdit, resultCount, totalCount, density, onDensityChange } = props;
  const sourceId = props.type === 'document' ? props.sourceId : undefined;
  const connectedPlatforms = props.type === 'contribution' ? props.connectedPlatforms : [];
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const defaultLists = getDefaultLists(type, connectedPlatforms);
  const { currentQuery, updateFilter, resetFilter } = useFilterAndSort({}, defaultLists);

  const topicTokens = splitList(currentQuery.topics);
  const { names: topicNames, isLoaded: topicsNamed } = useTopicNames(TOPICS_ITEM_TYPE[type], sourceId, topicTokens.filter(token => token !== UNTAGGED).join(','));

  const publishedBy = splitList(currentQuery.published_by);
  const { data: team } = useQuery({
    queryKey: [`/hubs/${hubId}/memberships`],
    queryFn: () => fetchHubEditors(hubId!),
    enabled: Boolean(hubId) && type === 'summary' && publishedBy.length > 0,
  });

  const chips: React.ReactElement[] = [];

  const pushFilter = (
    key: keyof DocumentsFilter,
    filter: keyof typeof filterMessages,
    value: string,
    stop: Partial<DocumentsFilter> = { [key]: undefined },
  ) => {
    const filterName = intl.formatMessage(filterMessages[filter]);
    chips.push(
      <Chip
        key={key}
        opensDialog
        removeLabel={intl.formatMessage(messages.removeFilter, { filter: filterName })}
        onClick={onEdit}
        onRemove={() => updateFilter(stop)}
      >
        <FormattedMessage
          id="activeFilters.chipLabelBold"
          defaultMessage="<strong>{filter}:</strong> {value}"
          description="What a list is filtered by, on a chip, as the name of the filter in bold, then what it is set to. Both are translated already: only the punctuation, its spacing, and the order of the two may need changing, and the placeholders must stay. Example: Date modified: Last 7 days"
          values={{ filter: filterName, value, strong: msg => <strong key="strong">{msg}</strong> }}
        />
      </Chip>,
    );
  };

  const named = (message: keyof typeof valueMessages) => intl.formatMessage(valueMessages[message]);

  // The date picker says "any" for the filter it does not apply, as the other filters say "all"
  const dateValue = (value?: string) => {
    if (!value || value === 'any') return undefined;
    const message = dateOptionMessages[value as keyof typeof dateOptionMessages];
    return message ? intl.formatMessage(message) : value;
  };

  const dateModified = dateValue(currentQuery.date_modified);
  if (dateModified) pushFilter('date_modified', 'dateModified', dateModified);

  const datePublished = dateValue(currentQuery.date_published);
  if (datePublished) pushFilter('date_published', 'datePublished', datePublished);

  if (publishedBy.length > 0) {
    const members = publishedBy.map(id => team?.find(({ user }: { user: User }) => String(user.id) === id)?.user);
    // The team is not known the moment the page is, so the chip says how many until it is
    const value = members.every(Boolean)
      ? intl.formatList(members.map(member => member!.name || member!.email))
      : intl.formatMessage(valueMessages.teamSelected, { count: publishedBy.length });
    pushFilter('published_by', 'publishedBy', value);
  }

  const platforms = splitList(currentQuery.platforms).filter(platform => platform !== 'any');
  if (platforms.length > 0 && !sameItems(platforms, defaultLists.platforms ?? [])) {
    pushFilter('platforms', 'platform', intl.formatList(platforms.map(platform => PLATFORM_NAMES[platform] ?? platform)));
  }

  // Both types is not a filter, as it is what the list is without one
  const participants = splitList(currentQuery.participants).filter(participant => ALL_PARTICIPANTS.includes(participant));
  if (type === 'contribution' && participants.length === 1) {
    pushFilter('participants', 'participants', named(participants[0] as 'anonymous' | 'trusted'));
  }

  const { status, priority_tier: priorityTier, notebooks } = currentQuery;
  if (status === 'paused' || status === 'active') pushFilter('status', 'status', named(status));
  if (priorityTier === '1') pushFilter('priority_tier', 'priorityTier', named('default'));
  if (priorityTier === '2') pushFilter('priority_tier', 'priorityTier', named('important'));

  // Choosing all of them is not a filter, as it is what the list is without one
  const syncStatuses = splitList(currentQuery.sync_status);
  if (syncStatuses.length > 0 && !sameItems(syncStatuses, defaultLists.sync_status)) {
    const statuses = syncStatuses.map(status => (status in syncStatusMessages ? intl.formatMessage(syncStatusMessages[status as SyncStatus]) : status));
    pushFilter('sync_status', 'processing', intl.formatList(statuses));
  }

  if (notebooks === 'true') pushFilter('notebooks', 'notebooks', named('inNotebooks'));
  if (notebooks === 'false') pushFilter('notebooks', 'notebooks', named('notInNotebooks'));

  const topicChips = topicTokens.map(token => {
    // Until the topics are named, which the address only has the ids of. After, one with no name is gone, but the
    // list is filtered by it still, so it is shown to be stopped
    const name = token === UNTAGGED ? named('untagged') : topicNames.get(token) ?? (topicsNamed ? intl.formatMessage(messages.unknownTopic) : undefined);
    if (!name) return null;

    const rest = topicTokens.filter(chosen => chosen !== token).join(',');
    return (
      <Chip
        key={token}
        opensDialog
        removeLabel={intl.formatMessage(messages.removeTopic, { name })}
        onClick={onEdit}
        // Without any topic left, how the topics filter is nothing to keep
        onRemove={() => updateFilter(rest ? { topics: rest } : { topics: undefined, topics_mode: undefined })}
      >
        {name}
      </Chip>
    );
  }).filter(chip => chip !== null);

  if (topicChips.length > 0) {
    chips.push(
      <span key="topics" className={styles.topicsGroup}>
        <span className={styles.topicsLabel}>
          <FormattedMessage
            id="activeFilters.topicsMode"
            defaultMessage="Topics: {mode}"
            description="Said before the topics a list is filtered by, on the group of them. {mode} is a select of whether the list shows the items that have any of the topics or none of them, which reads “Any of” or “None of”. Example: Topics: Any of"
            values={{
              mode: (
                <Select
                  key="mode"
                  aria-label={intl.formatMessage(messages.topicsModeLabel)}
                  value={currentQuery.topics_mode ?? 'include'}
                  onValueChange={value => updateFilter({ topics_mode: value === 'exclude' ? 'exclude' : undefined })}
                >
                  <SelectItem value="include"><AnyOf /></SelectItem>
                  <SelectItem value="exclude"><NoneOf /></SelectItem>
                </Select>
              ),
            }}
          />
        </span>
        {topicChips}
      </span>,
    );
  }

  const filtered = chips.length > 0 || topicTokens.length > 0;

  // With one chip, its own button does what clearing all does
  const removableCount = chips.length - (topicChips.length > 0 ? 1 : 0) + topicChips.length;

  return (
    <ul
      className={styles.activeFilters}
      aria-label={intl.formatMessage({
        id: 'activeFilters.label',
        defaultMessage: 'Active filters',
        description: 'Accessible name of the group of chips that say what a list is filtered by',
      })}
    >
      {resultCount !== undefined && (
        <li>
          <Tooltip content={intl.formatMessage(messages.filter)}>
            <Button
              aria-haspopup="dialog"
              label={
                filtered && totalCount !== undefined ? (
                  <FormattedMessage
                    id="activeFilters.resultCountOfTotal"
                    defaultMessage="{total, plural, one {{count} of # entry} other {{count} of # entries}}"
                    description="Button label, first in the row of what a list is filtered by, as how many entries the filters leave in the list, of how many entries there are in all. Clicking it opens the filters. Example: 3 of 26 entries"
                    values={{ count: resultCount, total: totalCount }}
                  />
                ) : (
                  <FormattedMessage
                    id="activeFilters.resultCount"
                    defaultMessage="{count, plural, one {# entry} other {# entries}}"
                    description="Button label, first in the row above a list, as how many entries it has. Clicking it opens the filters"
                    values={{ count: resultCount }}
                  />
                )
              }
              size="small"
              themeMode
              variant="text"
              onClick={onEdit}
            />
          </Tooltip>
        </li>
      )}
      {chips.map(chip => <li key={chip.key}>{chip}</li>)}
      {removableCount > 1 && (
        <li>
          <Button
            aria-label={intl.formatMessage(messages.clearAllFilters)}
            label={
              <FormattedMessage
                id="activeFilters.clearAll"
                defaultMessage="Clear all"
                description="Button label that stops a list being filtered by anything, shown beside what it is filtered by"
              />
            }
            size="small"
            themeMode
            variant="text"
            onClick={() => resetFilter()}
          />
        </li>
      )}
      <li className={styles.densityToggle}>
        <DensityToggle value={density} onChange={onDensityChange} />
      </li>
    </ul>
  );
};

export default ActiveFilters;
