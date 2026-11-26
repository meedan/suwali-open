import clsx from 'clsx';
import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useDebounce } from 'use-debounce';
import { useQuery } from '@tanstack/react-query';

import type { HubTopic } from '@customTypes/topic';

import { splitList } from '@helpers/lists';

import { fetchHubTopics } from '@services/TopicsService';

import { useSession } from '@root/SessionContext';

import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';
import { useTopicNames } from '@hooks/useTopicNames';

import Button from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import TextInput from '@ui-components/input/TextInput';
import Chip from '@ui-components/layout/Chip';
import Icon from '@ui-components/layout/Icon';
import { Popover, PopoverContent, PopoverTrigger } from '@ui-components/layout/Popover';
import listStyles from '@ui-components/layout/PopoverList.module.css';

import { ToggleFilter } from './FilterFields';
import { UNTAGGED } from './filterOptions';
import styles from './TopicsFilter.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const TOPICS_PER_PAGE = 50;

type ItemType = 'Document' | 'Contribution' | 'Notebook';

const messages = defineMessages({
  searchLabel: {
    id: 'global.topicsSearchLabel',
    defaultMessage: 'Search topics',
    description: 'Reusable accessible label of a field to search a list of topics',
  },
  searchPlaceholder: {
    id: 'global.topicsSearchPlaceholder',
    defaultMessage: 'Search topics…',
    description: 'Reusable placeholder of a field to search a list of topics',
  },
  untagged: {
    id: 'topicsFilter.untagged',
    defaultMessage: 'Untagged',
    description: 'Option of the topics to filter a list by, for the items that have no topics',
  },
  unknown: {
    id: 'topicsFilter.unknown',
    defaultMessage: 'Unknown topic',
    description: 'Label of a topic a list of data source items is filtered by, that no longer exists, such as one deleted since a link to the list was made',
  },
  modeLabel: {
    id: 'topicsFilter.modeLabel',
    defaultMessage: 'Show items with any or none of the topics',
    description: 'Accessible label of the select, beside the topics a list of data source items is filtered by, that sets whether the list shows the items with any of those topics or all but them',
  },
  remove: {
    id: 'topicsFilter.remove',
    defaultMessage: 'Remove {name} from the filter',
    description: 'Accessible label of the button that stops a list of data source items being filtered by a topic. Example: Remove Climate from the filter',
  },
});

export const AnyOf = () => (
  <FormattedMessage
    id="topicsFilter.anyOf"
    defaultMessage="Any of"
    description="Says a list of data source items is filtered to show the items that have at least one of the topics chosen, as in: Topics any of Climate, Housing"
  />
);

export const NoneOf = () => (
  <FormattedMessage
    id="topicsFilter.noneOf"
    defaultMessage="None of"
    description="Says a list of data source items is filtered to show all but the items that have any of the topics chosen, as in: Topics none of Climate, Housing"
  />
);

const UnknownTopic = () => (
  <FormattedMessage
    id="topicsFilter.unknown"
    defaultMessage="Unknown topic"
    description="Label of a topic a list of data source items is filtered by, that no longer exists, such as one deleted since a link to the list was made"
  />
);

const Untagged = () => (
  <FormattedMessage
    id="topicsFilter.untagged"
    defaultMessage="Untagged"
    description="Option of the topics to filter a list by, for the items that have no topics"
  />
);

type TopicsPickerProps = {
  itemType: ItemType;
  sourceId?: number;
  selected: string[];
  mode?: 'exclude';
  onToggle: (token: string) => void;
  onModeChange: (mode: 'exclude' | undefined) => void;
};

const TopicsPicker = ({ itemType, sourceId, selected, mode, onToggle, onModeChange }: TopicsPickerProps) => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const scope = { itemType, sourceId };

  const { items: topics, isPending, isError, hasNextPage, isFetchingNextPage, observerTarget } = useInfiniteScrollQuery<HubTopic>({
    queryKey: [`/hubs/${hubId}/topics`, 'list', itemType, sourceId ?? '', `q:${debouncedSearch}`],
    queryFn: (page, perPage) => fetchHubTopics(hubId!, page, perPage, debouncedSearch, scope),
    perPage: TOPICS_PER_PAGE,
    enabled: Boolean(hubId),
  });

  const { data: summary } = useQuery({
    queryKey: [`/hubs/${hubId}/topics`, 'untagged', itemType, sourceId ?? ''],
    queryFn: () => fetchHubTopics(hubId!, 1, 1, '', scope),
    enabled: Boolean(hubId),
  });
  const untaggedCount = summary?.untagged_count ?? 0;

  const showUntagged = !debouncedSearch && (untaggedCount > 0 || selected.includes(UNTAGGED));

  const option = (token: string, label: React.ReactNode, count: number) => (
    <li key={token}>
      <Checkbox
        id={`topics-filter-${token}`}
        value={token}
        checked={selected.includes(token)}
        onChange={() => onToggle(token)}
        label={<span className={listStyles.option}><span className={listStyles.name}>{label}</span><span className={listStyles.aside}>{count}</span></span>}
      />
    </li>
  );

  const renderList = () => {
    if (isPending) {
      return (
        <FormattedMessage
          id="global.topicsLoading"
          defaultMessage="Loading topics…"
          description="Reusable message shown while a list of topics is loading"
          tagName="p"
        />
      );
    }
    if (isError) {
      return (
        <FormattedMessage
          id="global.topicsLoadError"
          defaultMessage="We couldn’t load the topics. Please try again."
          description="Reusable message shown when a list of topics failed to load"
          tagName="p"
        />
      );
    }
    if (topics.length === 0 && !showUntagged) {
      return (
        <p>
          {debouncedSearch ? (
            <FormattedMessage
              id="global.topicsNoMatches"
              defaultMessage="No topics match your search."
              description="Reusable message shown when no topic matches what was searched for"
            />
          ) : (
            <FormattedMessage
              id="topicsFilter.noTopics"
              defaultMessage="None of the items in this list have topics yet."
              description="Shown when no item of a list of data source items has a topic, so there are none to filter it by"
            />
          )}
        </p>
      );
    }
    return (
      <ul className={listStyles.list}>
        {showUntagged && option(UNTAGGED, <Untagged />, untaggedCount)}
        {topics.map(topic => option(String(topic.id), topic.name, topic.items_count))}
        {hasNextPage && (
          <li className={listStyles.more}>
            <span ref={observerTarget} />
            {isFetchingNextPage && (
              <FormattedMessage
                id="global.topicsLoadingMore"
                defaultMessage="Loading more topics…"
                description="Reusable message shown at the end of a list of topics while the next ones are loading"
              />
            )}
          </li>
        )}
      </ul>
    );
  };

  return (
    <div className={listStyles.picker}>
      <ToggleFilter
        value={mode ?? 'include'}
        onChange={value => value && onModeChange(value === 'exclude' ? 'exclude' : undefined)}
        options={[
          {
            value: 'include',
            label: <AnyOf />,
          },
          {
            value: 'exclude',
            label: <NoneOf />,
          },
        ]}
      />
      <TextInput
        type="search"
        inputProps={{ 'aria-label': intl.formatMessage(messages.searchLabel) }}
        onChange={e => setSearch(e.target.value)}
        onClear={() => setSearch('')}
        placeholder={intl.formatMessage(messages.searchPlaceholder)}
        value={search}
      />
      {renderList()}
    </div>
  );
};

type TopicsFilterProps = {
  itemType: ItemType;
  sourceId?: number;
  topics?: string;
  mode?: 'exclude';
  onTopicsChange: (topics: string) => void;
  onModeChange: (mode: 'exclude' | undefined) => void;
};

// The topics a list is filtered by: to show the items that have any of them, or all but those
const TopicsFilter = ({ itemType, sourceId, topics, mode, onTopicsChange, onModeChange }: TopicsFilterProps) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const selected = splitList(topics);
  const ids = selected.filter(token => token !== UNTAGGED).join(',');
  const { names, isLoaded } = useTopicNames(itemType, sourceId, ids);

  const toggle = (token: string) => {
    const next = selected.includes(token) ? selected.filter(chosen => chosen !== token) : [...selected, token];
    onTopicsChange(next.join(','));
    if (next.length === 0 && mode) onModeChange(undefined);
  };

  const chip = (token: string, label: React.ReactNode, name: string) => (
    <Chip key={token} removeLabel={intl.formatMessage(messages.remove, { name })} onRemove={() => toggle(token)}>
      {label}
    </Chip>
  );

  return (
    <div className={styles.topicsFilter}>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            iconLeft={<Icon id="plus" aria-hidden />}
            label={
              <FormattedMessage
                id="global.addTopic"
                defaultMessage="Add topic"
                description="Reusable label of a button that opens a list of topics to choose one from"
              />
            }
            size="small"
            themeMode
          />
        </PopoverTrigger>
        <PopoverContent arrow={false} holdSide className={clsx(listStyles.popover, styles.popover)}>
          <TopicsPicker
            itemType={itemType}
            sourceId={sourceId}
            selected={selected}
            mode={mode}
            onToggle={toggle}
            onModeChange={onModeChange}
          />
        </PopoverContent>
      </Popover>
      <div className={styles.chips}>
        {selected.length === 0 ? (
          <span className={styles.mode}>
            <FormattedMessage
              id="topicsFilter.anyTopic"
              defaultMessage="Any topic"
              description="Shown, as what a list of data source items is filtered by, when no topic is chosen, so the list is not filtered by topics"
            />
          </span>
        ) : (
          <>
            <Select
              aria-label={intl.formatMessage(messages.modeLabel)}
              value={mode ?? 'include'}
              onValueChange={value => onModeChange(value === 'exclude' ? 'exclude' : undefined)}
            >
              <SelectItem value="include"><AnyOf /></SelectItem>
              <SelectItem value="exclude"><NoneOf /></SelectItem>
            </Select>
            {selected.map(token => {
              if (token === UNTAGGED) return chip(token, <Untagged />, intl.formatMessage(messages.untagged));
              const name = names.get(token);
              if (name) return chip(token, name, name);
              // So it can be stopped, as the list is filtered by it still
              return isLoaded ? chip(token, <UnknownTopic />, intl.formatMessage(messages.unknown)) : null;
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default TopicsFilter;
