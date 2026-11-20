import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";

type RewriterProps = {
  metadata: Message['metadata'];
};

const Rewriter = ({ metadata }: RewriterProps) => {
  return (
    <>
      <NodeContentTitle iconId="llm">
        <FormattedMessage
          id="global.rewriterNodetitle"
          defaultMessage="Preparing response to end-user message"
          description="Label that represents a work being done is to prepare to respond to a user question"
          tagName="span"
        />
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        { metadata.reasoning &&
          <>
            <p>
              {metadata.reasoning}
            </p>
            <br />
          </>
        }
        { metadata.rewritten_question &&
          <>
            <FormattedMessage
              id="rewriter.questionAdjusted"
              defaultMessage="End-user question adjusted with context"
              description="Header before displaying a LLM rewritten question"
              tagName="strong"
            />
            <blockquote>
              <p>
                {metadata.rewritten_question}
              </p>
            </blockquote>
          </>
        }
      </div>
    </>
  );
};

export default Rewriter;

