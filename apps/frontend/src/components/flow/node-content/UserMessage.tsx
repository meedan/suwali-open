import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

type UserMessageProps = {
  message: Message;
  body: Message['body'];
  topics?: Message['topic_names'];
  contextUpdates?: Message['metadata']['context_updates'];
};

const UserMessage = ({ message, body, topics, contextUpdates }: UserMessageProps) => {
  return (
    <>
      <NodeContentTitle iconId="user">
        <FormattedMessage
          id="global.userMessageNodetitle"
          defaultMessage="End-user message details"
          description="Label that represents a message originated from the User"
          tagName="span"
        />
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
          {topics && topics.length > 0 &&
            <div>
              <FormattedMessage
                id="global.topics"
                defaultMessage="Topics"
                description="Label for the topics from a message or document"
                tagName="dt"
              />
              <dd>{topics.join(", ")}</dd>
            </div>
          }
          {contextUpdates && contextUpdates.length > 0 &&
            <div className={styles.stackedField}>
              <FormattedMessage
                id="global.conversationContextUpdated"
                defaultMessage="Conversation context updated"
                description="Label for the changes this user message made to the notes kept about the user in the conversation, such as their location"
                tagName="dt"
              />
              <dd>
                <ul className={styles.bulletList}>
                  {contextUpdates.map((update) => (
                    <li key={`${update.op}-${update.text}`}>
                      {update.op === 'add' ?
                        <FormattedMessage
                          id="global.conversationContextNoteAdded"
                          defaultMessage="Added: {note}"
                          description="A note about the user saved to the conversation context, such as “Lives in Lagos”"
                          values={{ note: update.text }}
                        /> :
                        <FormattedMessage
                          id="global.conversationContextNoteRemoved"
                          defaultMessage="Removed: {note}"
                          description="A note about the user removed from the conversation context, usually because a newer one replaced it"
                          values={{ note: update.text }}
                        />
                      }
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          }
        </dl>
      </div>
    </>
  );
};

export default UserMessage;

