import { FormattedMessage, useIntl } from 'react-intl';

import type { ConversationFrom } from '@customTypes/conversation';

import { type DocumentsFilter, useFilterAndSort } from '@hooks/useFilterAndSort';

import styles from '@pages/data-sources/DataSourcesDocumentsFilter.module.css';
import { CheckboxFilter, DateSelect, FilterRow } from '@pages/data-sources/FilterFields';
import { FilterModal } from '@pages/data-sources/FilterModal';
import { getEndUserDefaultLists } from '@pages/data-sources/filterOptions';

const PLATFORM_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS', signal: 'Signal', internal: 'Internal' };

type ConversationsFilterModalProps = {
  connectedPlatforms: Array<'whatsapp' | 'telegram' | 'sms' | 'signal' | 'internal'>;
  defaultQuery?: Partial<DocumentsFilter>;
  from: ConversationFrom;
  // Spells out "Filters (N)" instead of just the count, for use where there's no nearby
  // context (like the list itself) to make a bare number legible
  verboseButton?: boolean;
};

export const ConversationsFilterModal = ({
  connectedPlatforms,
  defaultQuery = {},
  from,
  verboseButton = false,
}: ConversationsFilterModalProps) => {
  const intl = useIntl();
  // Who the conversation is with and its platform only vary for audience conversations. The API's
  // participant filter also matches only end-users, so setting it anywhere else would empty the list.
  const hasAudienceFilters = from === 'audience';

  const {
    stateQuery,
    setFilter,
    applyFilter,
    resetFilter,
    discardChanges,
    activeFiltersCount,
  } = useFilterAndSort(defaultQuery, hasAudienceFilters ? getEndUserDefaultLists(connectedPlatforms) : {});

  const lastMessage = stateQuery.last_message ?? 'any';
  const firstMessage = stateQuery.first_message ?? 'any';

  const [dateRangeFrom, dateRangeTo] = stateQuery.has_message ? stateQuery.has_message.split(',') : [null, null];

  return (
    <FilterModal
      title={
        <FormattedMessage
          id="global.filterConversationsBy"
          defaultMessage="Filter conversations by"
          description="Filter dialog title"
        />
      }
      activeFiltersCount={activeFiltersCount}
      onApply={() => applyFilter()}
      onReset={resetFilter}
      onDiscard={discardChanges}
      verboseButton={verboseButton}
    >
      { dateRangeFrom && dateRangeTo && (
        <FilterRow
          fill
          label={
            <FormattedMessage
              id="global.dateRange"
              defaultMessage="Date range"
              description="Date filter option for date range"
            />
          }
        >
          <div className={styles.filterText}>
            <FormattedMessage
              id="conversationsFilter.from"
              defaultMessage="<strong>From:</strong> {from} — <strong>To:</strong> {to}"
              description="Label for date range filter, showing the selected start and end dates. Example: From: Jan 1, 2024 - To: Jan 31, 2024"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
                from: intl.formatDate(new Date(dateRangeFrom + "T00:00:00"), { year: 'numeric', month: 'short', day: 'numeric' }),
                to: intl.formatDate(new Date(dateRangeTo + "T00:00:00"), { year: 'numeric', month: 'short', day: 'numeric' }),
              }}
            />
          </div>
        </FilterRow>
      )}

      <FilterRow
        fill
        label={
          <FormattedMessage
            id="conversationsFilter.mostRecentMessage"
            defaultMessage="Most recent message"
            description="Label for most recent message filter"
          />
        }
      >
        <DateSelect
          value={lastMessage}
          onChange={value => setFilter('last_message', value)}
          disabled={!!(dateRangeFrom || dateRangeTo)}
        />
      </FilterRow>

      <FilterRow
        fill
        label={
          <FormattedMessage
            id="conversationsFilter.firstMessage"
            defaultMessage="First message"
            description="Label for first message filter"
          />
        }
      >
        <DateSelect
          value={firstMessage}
          onChange={value => setFilter('first_message', value)}
          disabled={!!(dateRangeFrom || dateRangeTo)}
        />
      </FilterRow>

      {hasAudienceFilters &&
        <>
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
              value={stateQuery.participants}
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
              // 'any' is how a permalink says all of them
              value={stateQuery.platforms === 'any' ? undefined : stateQuery.platforms}
              onChange={value => setFilter('platforms', value)}
              options={connectedPlatforms.map(platform => ({
                value: platform,
                label: PLATFORM_LABELS[platform],
              }))}
            />
          </FilterRow>
        </>
      }
    </FilterModal>
  );
};
