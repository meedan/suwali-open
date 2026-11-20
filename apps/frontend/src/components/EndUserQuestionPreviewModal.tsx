import { useIntl } from "react-intl";

import type { MessageCluster } from "@customTypes/message-cluster";

import { endUserQuestionMessages, useClusterMessages } from "@hooks/useClusterMessages";

import ConversationMetaItems from "./ConversationMetaItems";
import {
  EndUserQuestionChat,
  EndUserQuestionNavigation,
} from "./EndUserQuestionPreviewContent";
import styles from "./EndUserQuestionPreviewModal.module.css";
import PreviewModalBase from "./PreviewModalBase";
import ViewConversationButton from "./ViewConversationButton";

type EndUserQuestionPreviewModalProps = {
  cluster: MessageCluster | null;
  answered: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EndUserQuestionPreviewModal = ({
  cluster,
  answered,
  open,
  onOpenChange,
}: EndUserQuestionPreviewModalProps) => {
  const intl = useIntl();
  const { currentMessage, pagination, page, setPage } = useClusterMessages(
    cluster?.id,
    answered,
    { enabled: open },
  );

  if (!cluster) return null;

  return (
    <PreviewModalBase
      open={open}
      onOpenChange={onOpenChange}
      title={intl.formatMessage(answered ? endUserQuestionMessages.answeredTitle : endUserQuestionMessages.unansweredTitle)}
      details={<ConversationMetaItems conversation={currentMessage?.conversation} />}
      actions={
        <div className={styles.footer}>
          <EndUserQuestionNavigation
            pagination={pagination}
            page={page}
            setPage={setPage}
          />
          <ViewConversationButton
            conversation={currentMessage?.conversation}
            messageId={currentMessage?.id}
          />
        </div>
      }
      content={<EndUserQuestionChat currentMessage={currentMessage} />}
    />
  );
};

export default EndUserQuestionPreviewModal;
