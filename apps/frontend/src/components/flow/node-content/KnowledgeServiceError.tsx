import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import ReportMessageButton from "./ReportMessageButton";
import TimestampField from "./TimestampField";

type KnowledgeServiceErrorProps = {
  message: Message;
  body: Message['body'];
  messageId: Message['id'];
  metadata: Message['metadata'];
};

const KnowledgeServiceError = ({ message, body, messageId, metadata }: KnowledgeServiceErrorProps) => {
  return (
    <>
      <NodeContentTitle iconId="error">
        <FormattedMessage
          id="global.knowledgeServiceErrorNodetitle"
          defaultMessage="Knowledge service error"
          description="Label that represents an error from the knowledge service"
          tagName="span"
        />
      </NodeContentTitle>

      <div className={styles.nodeContent}>
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
          {metadata?.error_type && (
            <div>
              <FormattedMessage
                id="knowledgeServiceError.errorType"
                defaultMessage="Error type"
                description="Label for the kind of error the knowledge service reported while answering a message"
                tagName="dt"
              />
              <dd>
                {metadata.error_type}
              </dd>
            </div>
          )}
        </dl>
        <ReportMessageButton messageId={messageId} messageBody={body} />
      </div>
    </>
  );
};

export default KnowledgeServiceError;
