import { FormattedMessage } from 'react-intl';

import type { Conversation } from '@customTypes/conversation';

import { getPlatformIcon, platformIconNeedsInlineSvg } from '@helpers/conversation';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteConversationModalProps = {
  open: boolean;
  conversation: Conversation | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const getDisplayTitle = (conversation: Conversation | null) =>
  conversation?.participant?.type === 'ExternalUser' ? conversation.participant.name : conversation?.title;

const ConfirmDeleteConversationModal = ({
  open,
  conversation,
  onCancel,
  onConfirm,
}: ConfirmDeleteConversationModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="global.confirmDeleteConversationModaltitle"
        defaultMessage="Remove conversation?"
        description="Confirmation dialog title before deleting a conversation"
      />
    }
    titleContext={
      <>
        {conversation && <Icon id={getPlatformIcon(conversation.platform)} inlineSvg={platformIconNeedsInlineSvg(conversation.platform)} aria-hidden />}
        <strong title={getDisplayTitle(conversation)}>{getDisplayTitle(conversation)}</strong>
      </>
    }
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
              id="global.deleteConversation"
              defaultMessage="Remove conversation"
              description="Reusable label for Delete conversation action"
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
          id="global.confirmDeleteConversationModalwarningMessage"
          defaultMessage="This conversation and its messages will be permanently removed."
          description="Confirmation dialog message before deleting a conversation"
          tagName="p"
        />
        <FormattedMessage
          id="global.confirmDeleteConversationModalStatsMessage"
          defaultMessage="It will also be removed from your dashboard statistics, both live and historical, and from any topics or notebooks that include it. Totals and trends will change."
          description="Confirmation dialog message explaining how deleting a conversation affects statistics, topics and notebooks"
          tagName="p"
        />
        <FormattedMessage
          id="global.cannotBeUndoneAreYouSure"
          defaultMessage="This action <strong>cannot be undone</strong>. Are you sure?"
          description="Reusable confirmation dialog message before deleting something"
          tagName="p"
          values={{
            strong: msg => (<strong key="strong">{msg}</strong>),
          }}
        />
      </>
    }
  />
);

export default ConfirmDeleteConversationModal;
