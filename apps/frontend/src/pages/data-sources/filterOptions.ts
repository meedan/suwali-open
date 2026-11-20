import { defineMessages } from 'react-intl';

// What the server takes for the items that have no topics, beside the ids of the topics
export const UNTAGGED = 'none';

export const dateOptionMessages = defineMessages({
  any: {
    id: 'global.dateAnyTime',
    defaultMessage: 'Any time',
    description: 'Date filter option for any time',
  },
  today: {
    id: 'global.dateToday',
    defaultMessage: 'Today',
    description: 'Date filter option for today',
  },
  yesterday: {
    id: 'global.dateYesterday',
    defaultMessage: 'Yesterday',
    description: 'Date filter option for yesterday',
  },
  last_7_days: {
    id: 'global.dateLast7Days',
    defaultMessage: 'Last 7 days',
    description: 'Date filter option for last 7 days',
  },
  last_30_days: {
    id: 'global.dateLast30Days',
    defaultMessage: 'Last 30 days',
    description: 'Date filter option for last 30 days',
  },
  last_90_days: {
    id: 'global.dateLast90Days',
    defaultMessage: 'Last 90 days',
    description: 'Date filter option for last 90 days',
  },
  more_than_90: {
    id: 'global.dateMoreThan90',
    defaultMessage: 'More than 90 days ago',
    description: 'Date filter option for more than 90 days ago',
  },
});

export const ALL_PARTICIPANTS = ['anonymous', 'trusted'];

type ListType = 'contribution' | 'document' | 'summary';

export type SyncStatus = 'complete' | 'pending' | 'error' | 'unsupported';

export const syncStatusMessages = defineMessages({
  complete: {
    id: 'global.processingStatusComplete',
    defaultMessage: 'Complete',
    description: 'Label for complete status filter option',
  },
  pending: {
    id: 'global.processingStatusPending',
    defaultMessage: 'Processing',
    description: 'Label for processing status filter option',
  },
  error: {
    id: 'global.processingStatusError',
    defaultMessage: 'Error',
    description: 'Label for error status filter option',
  },
  unsupported: {
    id: 'global.processingStatusUnsupported',
    defaultMessage: 'Unsupported',
    description: 'Label for the filter option that shows files that could not be imported',
  },
});

// "unsupported" is a document-only pseudo-status for skipped files; the backend ignores it when querying.
export const getDefaultSyncStatuses = (type: ListType): SyncStatus[] => (
  type === 'document' ? ['complete', 'pending', 'error', 'unsupported'] : ['complete', 'pending', 'error']
);

export const getEndUserDefaultLists = (connectedPlatforms: string[]): Record<string, string[]> => ({
  platforms: connectedPlatforms,
  participants: ALL_PARTICIPANTS,
});

export const getDefaultLists = (type: ListType, connectedPlatforms: string[] = []): Record<string, string[]> => ({
  sync_status: getDefaultSyncStatuses(type),
  ...(type === 'contribution' ? getEndUserDefaultLists(connectedPlatforms) : {}),
});
