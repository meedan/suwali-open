import { FormattedMessage } from 'react-intl';

import type { Topic } from '@customTypes/topic';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteTopicModalProps = {
  open: boolean;
  topic: Topic | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDeleteTopicModal = ({
  open,
  topic,
  onCancel,
  onConfirm,
}: ConfirmDeleteTopicModalProps) => (
  <Modal
    alert
    title={(
      <FormattedMessage
        id="global.confirmDeleteTopicModaltitle"
        defaultMessage="Remove topic?"
        description="Confirmation dialog title before removing a topic from a data source item"
      />
    )}
    titleContext={topic && <strong title={topic.name}>{topic.name}</strong>}
    open={open}
    size="small"
    actions={
      <>
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
              id="global.confirmDeleteTopicModalconfirm"
              defaultMessage="Remove topic"
              description="Confirmation dialog submit button label before removing a topic"
            />
          }
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        <FormattedMessage
          id="global.confirmDeleteTopicModalwarningMessage"
          defaultMessage="The topic <strong>{topic}</strong> will be removed from this item."
          description="Confirmation dialog message before removing a topic from a data source item"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
            topic: topic?.name
          }}
        />
        <FormattedMessage
          id="global.confirmDeleteTopicModalwarningMessageContinued"
          defaultMessage="This item will no longer be used for notifying audience subscriptions for <strong>{topic}</strong>."
          description="Confirmation dialog message before removing a topic from a data source item about audience notifications"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
            topic: topic?.name
          }}
        />
      </>
    }
  />
);

export default ConfirmDeleteTopicModal;
