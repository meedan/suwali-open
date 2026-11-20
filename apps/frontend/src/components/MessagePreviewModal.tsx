import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import type { Message } from "@customTypes/message";

import { fetchConversation } from "@services/ConversationsService";

import DatePill from "@ui-components/layout/DatePill";
import MessageBubble from "@ui-components/layout/MessageBubble";
import ParsedText from "@ui-components/layout/ParsedText";

import ConversationMetaItems from "@components/ConversationMetaItems";
import MessageTimestamp from "@components/MessageTimestamp";
import PreviewModalBase from "@components/PreviewModalBase";
import ViewConversationButton from "@components/ViewConversationButton";

import styles from "./MessagePreviewModal.module.css";

type MessagePreviewModalProps = {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MessagePreviewModal = ({ message, open, onOpenChange }: MessagePreviewModalProps) => {
  const queryPath = `/conversations/${message.conversation_id}`;

  const conversationQuery = useQuery({
    queryKey: [queryPath],
    queryFn: () => fetchConversation(message.conversation_id),
  });

  const details = <ConversationMetaItems conversation={conversationQuery.data} />;

  const actions = (
    <ViewConversationButton conversation={conversationQuery.data} messageId={message.id} />
  );

  const messageDate = new Date(message.created_at);

  const content = (
    <div className={styles.content}>
      <DatePill size="large" value={messageDate} />
      <MessageBubble
        direction={message.direction === "incoming" ? "incoming" : "outgoing"}
        size="large"
        timestamp={<MessageTimestamp message={message} />}
      >
        <ParsedText text={message.body} />
      </MessageBubble>
    </div>
  );

  return (
    <PreviewModalBase
      open={open}
      onOpenChange={onOpenChange}
      title={
        <FormattedMessage
          id="global.message"
          defaultMessage="Message"
          description="Generic label or title for an individual message from a conversation"
        />
      }
      details={details}
      actions={actions}
      content={content}
    />
  );
};

export default MessagePreviewModal;
