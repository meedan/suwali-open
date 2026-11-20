import { FormattedMessage } from "react-intl";

import type { Conversation } from "@customTypes/conversation";

import { getConversationTitle } from "@helpers/conversation";

import MetaList from "@ui-components/layout/MetaList";
import { Modal } from "@ui-components/layout/Modal";

import ConversationMetaItems from "@components/ConversationMetaItems";
import ViewConversationButton from "@components/ViewConversationButton";

import ConversationsMessagesPanel from "@pages/conversations/ConversationsMessagesPanel";

type ConversationPreviewModalProps = {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ConversationPreviewModal = ({
  conversation,
  open,
  onOpenChange,
}: ConversationPreviewModalProps) => {
  const details = (
    <MetaList>
      <ConversationMetaItems conversation={conversation} />
    </MetaList>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <FormattedMessage
          id="global.conversation"
          defaultMessage="Conversation"
          description="Reusable label for Conversation page or title"
        />
      }
      titleContext={conversation.participant.type === "User" ? getConversationTitle(conversation) : null}
      details={details}
      actions={<ViewConversationButton conversation={conversation} />}
      body={<ConversationsMessagesPanel conversationId={conversation.id} />}
      size="large"
    />
  );
};

export default ConversationPreviewModal;
