import clsx from 'clsx';
import { useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useDebounce } from 'use-debounce';
import { useQuery } from '@tanstack/react-query';

import type { HubTopic } from '@customTypes/topic';

import { fetchAbout } from '@services/AboutService';
import { addTopicItem, fetchHubTopics } from '@services/TopicsService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import Icon from '@ui-components/layout/Icon';
import { Popover, PopoverContent, PopoverTrigger } from '@ui-components/layout/Popover';
import listStyles from '@ui-components/layout/PopoverList.module.css';

import styles from './AddTopic.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const TOPICS_PER_PAGE = 50;

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
  optionLabel: {
    id: 'addTopic.optionLabel',
    defaultMessage: '{name}, {count, plural, one {# item} other {# items}}',
    description: 'Accessible label of a topic that can be added to an item, with the number of items it is already on',
  },
  created: {
    id: 'addTopic.created',
    defaultMessage: 'Topic “{name}” created and added',
    description: 'Toast message when a new topic was created in the hub, from what was searched for, and added to a data source item',
  },
  addError: {
    id: 'addTopic.addError',
    defaultMessage: 'There was an error adding the topic. Please try again.',
    description: 'Error message when failing to add a topic to a data source item',
  },
});

export type AddTopicTarget = {
  itemType: 'Document' | 'Contribution' | 'Notebook';
  itemId: number;
  // Called once the topic is added, so the item can be shown with it
  onAdded: () => void;
};

type TopicPickerProps = AddTopicTarget & {
  // The names of the topics the item has, which are left out of the list. Not their ids: those of the topics of an
  // item are of its topic items. Names are unique within a hub.
  existingTopicNames: string[];
  onDone: () => void;
};

// The topics of the hub, to filter and choose from
const TopicPicker = ({ itemType, itemId, onAdded, existingTopicNames, onDone }: TopicPickerProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  const hubId = useSession().currentHubId();
  // Any member can add a topic the hub has, but creating one adds to the topics of the whole hub, so is for admins
  const mayCreateTopic = useCan('CREATE_TOPIC').allowed;
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const createRef = useRef<HTMLButtonElement>(null);
  // Not known until the server has said, so nothing is limited here before then, and the server still validates it
  const { data: about } = useQuery({ queryKey: ['/about'], queryFn: fetchAbout });

  // What is searched for waits for a pause in typing, so a request is not made for every key
  const [debouncedSearch] = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);

  // The topics come a page at a time, as the list is scrolled, and are searched on the server, which has them all
  const { items: topics, isPending, isError, hasNextPage, isFetchingNextPage, observerTarget } = useInfiniteScrollQuery<HubTopic>({
    queryKey: [`/hubs/${hubId}/topics`, `q:${debouncedSearch}`],
    queryFn: (page, perPage) => fetchHubTopics(hubId!, page, perPage, debouncedSearch),
    perPage: TOPICS_PER_PAGE,
    enabled: Boolean(hubId),
  });

  const matches = topics.filter(topic => !existingTopicNames.includes(topic.name));
  // Whether the list on show is for what is in the search field, and not for what was in it before the pause
  const typed = search.trim();
  const isCurrent = typed === debouncedSearch && !isPending;

  // A topic can be created from what was typed, once the topics that match it have loaded, and if none is of that
  // name. Those the item has count: it is not for making a second one.
  const hasTopicNamedAsTyped = topics.some(topic => topic.name.toLowerCase() === typed.toLowerCase());
  const canCreate = mayCreateTopic && isCurrent && !isError && typed !== '' && !hasTopicNamedAsTyped;

  const add = async (topic: { topicId: number } | { topicName: string }) => {
    setAdding(true);
    try {
      const added = await addTopicItem({ ...topic, itemType, itemId });
      // Said only for a topic that is new to the hub, as the chip that appears shows the topic was added
      if (added?.topic_created) toast('success', intl.formatMessage(messages.created, { name: added.name }));
      onAdded();
      onDone();
    } catch {
      toast('error', intl.formatMessage(messages.addError));
      setAdding(false);
    }
  };

  const focusOption = (index: number) => optionRefs.current[index]?.focus();

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
          defaultMessage="The topics could not be loaded. Please try again."
          description="Reusable message shown when a list of topics failed to load"
          tagName="p"
        />
      );
    }
    // Nothing to show yet, but there is more to come: all the topics of a page may be ones the item already has
    if (matches.length === 0 && !hasNextPage) {
      return (
        <p>
          {topics.length === 0 ? (
            debouncedSearch ? (
              <FormattedMessage
                id="global.topicsNoMatches"
                defaultMessage="No topics match your search."
                description="Reusable message shown when no topic matches what was searched for"
              />
            ) : (
              <FormattedMessage
                id="addTopic.noTopics"
                defaultMessage="This hub has no topics yet."
                description="Shown when the hub has no topics that can be added to an item"
              />
            )
          ) : debouncedSearch ? (
            <FormattedMessage
              id="addTopic.matchesAdded"
              defaultMessage="The topics that match your search are already on this item."
              description="Shown when the topics that match what was searched for are all on the item, so there are none left to add"
            />
          ) : (
            <FormattedMessage
              id="addTopic.allAdded"
              defaultMessage="Every topic of this hub is already on this item."
              description="Shown when the item has all the topics of the hub, so there are none left to add"
            />
          )}
        </p>
      );
    }
    return (
      <ul className={listStyles.list}>
        {matches.map((topic, index) => (
          <li key={topic.id}>
            <Button
              aria-label={intl.formatMessage(messages.optionLabel, { name: topic.name, count: topic.items_count })}
              disabled={adding}
              label={
                <span className={listStyles.option}>
                  <span className={listStyles.name} title={topic.name}>{topic.name}</span>
                  {/* A dash where the topic is not on any item, which the label of the button says in words */}
                  <span className={listStyles.aside}>{topic.items_count > 0 ? topic.items_count : '–'}</span>
                </span>
              }
              onClick={() => add({ topicId: topic.id })}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (index === matches.length - 1) createRef.current?.focus();
                  else focusOption(index + 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  focusOption(index - 1);
                }
              }}
              ref={node => { optionRefs.current[index] = node; }}
              size="small"
              themeMode
              variant="menu"
            />
          </li>
        ))}
        {hasNextPage && (
          <li className={listStyles.more}>
            {/* Scrolled into view, it loads the next page of topics */}
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
      <TextInput
        inputProps={{ 'aria-label': intl.formatMessage(messages.searchLabel), maxLength: about?.max_topic_name_length }}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (matches.length > 0) focusOption(0);
            else createRef.current?.focus();
          } else if (e.key === 'Enter' && isCurrent && matches.length > 0 && !adding) {
            e.preventDefault();
            add({ topicId: matches[0].id });
          }
        }}
        placeholder={intl.formatMessage(messages.searchPlaceholder)}
        value={search}
      />
      {renderList()}
      {canCreate && (
        // Outside the scrolling list, so it is in reach however many topics match
        <div className={clsx(listStyles.footer, styles.create)}>
          <Button
            disabled={adding}
            iconLeft={<Icon id="plus" aria-hidden />}
            label={
              <FormattedMessage
                id="addTopic.create"
                defaultMessage="Create “{name}”"
                description="Button that creates a topic named as what was searched for, in the hub, and adds it to the item"
                values={{ name: typed }}
              />
            }
            onClick={() => add({ topicName: typed })}
            onKeyDown={e => {
              if (e.key === 'ArrowUp' && matches.length > 0) {
                e.preventDefault();
                focusOption(matches.length - 1);
              }
            }}
            ref={createRef}
            size="small"
            themeMode
            variant="menu"
          />
        </div>
      )}
    </div>
  );
};

type AddTopicProps = AddTopicTarget & {
  existingTopicNames: string[];
};

// Adds one of the topics of the hub to an item
const AddTopic = ({ existingTopicNames, ...target }: AddTopicProps) => {
  const [open, setOpen] = useState(false);

  return (
    // Modal, because the preview it is opened from is a modal dialog, whose scroll lock stops the list scrolling
    // otherwise: the list is not inside the dialog, as it is shown over the page
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className={styles.trigger}
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
        <TopicPicker {...target} existingTopicNames={existingTopicNames} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};

export default AddTopic;
