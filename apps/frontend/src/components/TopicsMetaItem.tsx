import type { ReactNode } from "react";
import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import type { Topic } from "@customTypes/topic";

import { deleteTopicItem } from "@services/TopicsService";

import { useToast } from "@hooks/useToast";

import Chip from "@ui-components/layout/Chip";
import Tooltip from '@ui-components/layout/Tooltip';

import AddTopic, { type AddTopicTarget } from "./AddTopic";
import ConfirmDeleteTopicModal from "./ConfirmDeleteTopicModal";
import PreviewDetails from "./PreviewDetails";
import styles from './TopicsMetaItem.module.css';

const messages = defineMessages({
  removeTopic: {
    id: 'global.topicsMetaItemremove',
    defaultMessage: 'Remove topic {name}',
    description: 'Accessible label for the button that removes a topic from a data source item',
  },
  failedToDelete: {
    id: 'topicsMetaItem.failedToDelete',
    defaultMessage: 'There was an error when removing topic. Please try again.',
    description: 'Error message when failing to delete a topic from a data source item',
  }
});

type TopicsMetaItemProps = {
  topics?: Topic[];
  onTopicDeleted?: () => void;
  title?: ReactNode;
  // As a field of the details of an item, with the label above the topics, and not on the row with them
  stacked?: boolean;
  // Offers to add a topic of the hub to the item the topics are of, which shows even when it has none
  addTopic?: AddTopicTarget;
};

const TopicsMetaItem = ({ topics = [], onTopicDeleted, title, stacked = false, addTopic }: TopicsMetaItemProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  const [topicToDelete, setTopicToDelete] = useState<Topic | null>(null);

  if (topics.length === 0 && !addTopic) return null;

  const handleConfirm = async () => {
    if (!topicToDelete) return;
    try {
      await deleteTopicItem(topicToDelete.id);
      onTopicDeleted?.();
    } catch {
      toast('error', intl.formatMessage(messages.failedToDelete));
    } finally {
      setTopicToDelete(null);
    }
  };

  const labelText = title ?? (
    <FormattedMessage
      id="global.topics"
      defaultMessage="Topics"
      description="Label for the topics from a message or document"
    />
  );

  const label = (
    <Tooltip
      content={
        <FormattedMessage
          id="topicsMetaItem.describeTopics"
          defaultMessage="We generate topics automatically from the document’s content. You can remove them."
          description="Description of how topics are applied to documents"
        />
      }
    >
      {stacked ? <span>{labelText}</span> : <strong>{labelText}:</strong>}
    </Tooltip>
  );

  const chips = (
    <span className={styles.chips}>
      {topics.map(topic => (
        <Chip
          key={topic.id}
          removeLabel={intl.formatMessage(messages.removeTopic, { name: topic.name })}
          removeTooltip={
            <FormattedMessage
              id="global.removeTopic"
              defaultMessage="Remove topic"
              description="Tooltip text for copy text to clipboard"
            />
          }
          onRemove={onTopicDeleted ? () => setTopicToDelete(topic) : undefined}
        >
          {topic.name}
        </Chip>
      ))}
    </span>
  );

  // On a row of its own, below the topics, so the action stands out from them
  const add = addTopic && <AddTopic {...addTopic} existingTopicNames={topics.map(topic => topic.name)} />;

  return (
    <>
      {stacked ? (
        <PreviewDetails.Field label={label}>
          <div className={styles.stackedValue}>
            {topics.length > 0 && chips}
            {add}
          </div>
        </PreviewDetails.Field>
      ) : (
        <>
          {label}
          {chips}
          {add}
        </>
      )}
      <ConfirmDeleteTopicModal
        open={Boolean(topicToDelete)}
        topic={topicToDelete}
        onCancel={() => setTopicToDelete(null)}
        onConfirm={handleConfirm}
      />
    </>
  );
};

export default TopicsMetaItem;
