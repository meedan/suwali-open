import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { Topic } from '@customTypes/topic';

import Chip from '@ui-components/layout/Chip';

import styles from './TopicChips.module.css';

const messages = defineMessages({
  topics: {
    id: 'global.topics',
    defaultMessage: 'Topics',
    description: 'Label for the topics from a message or document',
  },
  filterBy: {
    id: 'topicChips.filterBy',
    defaultMessage: 'Filter by {name}',
    description: 'Accessible label and tooltip of a topic chip that filters the list it is in by that topic. Example: Filter by Climate',
  },
});

type TopicChipsProps<T extends Topic> = {
  topics: T[];
  onTopicClick?: (topic: T) => void;
  isActive?: (topic: T) => boolean;
};

const TopicChips = <T extends Topic>({ topics, onTopicClick, isActive }: TopicChipsProps<T>) => {
  const intl = useIntl();

  if (topics.length === 0) return null;

  return (
    <ul className={styles.topicChips} aria-label={intl.formatMessage(messages.topics)}>
      {topics.map(topic => {
        const active = isActive?.(topic) ?? false;

        return (
          <li key={topic.id}>
            {onTopicClick ? (
              <Chip
                className={clsx(active && styles.activeTopicChip)}
                clickLabel={intl.formatMessage(messages.filterBy, { name: topic.name })}
                clickTooltip={active ? (
                  <FormattedMessage
                    id="topicChips.stopFilteringBy"
                    defaultMessage="Stop filtering by {name}"
                    description="Tooltip of a topic chip that the list it is in is filtered by, as clicking it stops that. Example: Stop filtering by Climate"
                    values={{ name: topic.name }}
                  />
                ) : (
                  <FormattedMessage
                    id="topicChips.filterBy"
                    defaultMessage="Filter by {name}"
                    description="Accessible label and tooltip of a topic chip that filters the list it is in by that topic. Example: Filter by Climate"
                    values={{ name: topic.name }}
                  />
                )}
                pressed={isActive ? active : undefined}
                onClick={event => {
                  event.stopPropagation();
                  onTopicClick(topic);
                }}
              >
                {topic.name}
              </Chip>
            ) : (
              <Chip className={styles.topicChip}>{topic.name}</Chip>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default TopicChips;
