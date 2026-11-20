import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

const processingStepLabels: Record<Message['metadata']['step'], React.ReactNode> = {
  parsing_question: (
    <FormattedMessage
      id="global.systemProcessingNodeParsingQuestion"
      defaultMessage="Parsing question"
      description="Label that represents the system is parsing the user question"
    />
  ),
  searching_sources: (
    <FormattedMessage
      id="global.systemProcessingNodeSearchingSources"
      defaultMessage="Searching sources"
      description="Label that represents the system is searching for relevant sources"
    />
  ),
  evaluating_results: (
    <FormattedMessage
      id="global.systemProcessingNodeEvaluatingResults"
      defaultMessage="Evaluating results"
      description="Label that represents the system is evaluating the search results"
    />
  ),
};

type SystemProcessingProps = {
  message?: Message;
  body: Message['body'];
  metadata?: Message['metadata'];
};

const SystemProcessing = ({ message, body, metadata }: SystemProcessingProps) => {
  return (
    <>
      <NodeContentTitle iconId="lightning">
        <FormattedMessage
          id="global.systemProcessingNodetitle"
          defaultMessage="System processing"
          description="Label that represents a message originated from the User"
          tagName="span"
        />
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        { !body || body === '...' ? (
          <FormattedMessage
            id="global.systemProcessingNodedescription"
            defaultMessage="The system is processing the preceding end-user message and preparing to respond."
            description="Tooltip style output that explains what this node represents, which is the system working to craft a response"
            tagName="p"
          />
        ) : (
          <NodeQuote body={body} />
        )}
        <dl>
        { message && <TimestampField message={message} /> }
        { metadata?.step && (
          <div>
            <FormattedMessage
              id="global.processingStep"
              defaultMessage="Processing step"
              description="Label for processing step"
              tagName="dt"
            />
            <dd>{processingStepLabels[metadata.step]}</dd>
          </div>
        )}
        </dl>
      </div>
    </>
  );
};

export default SystemProcessing;

