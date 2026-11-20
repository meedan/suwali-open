import type { ReactNode } from "react";

import type { Message } from "@customTypes/message";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import TimestampField from "./TimestampField";

type SystemNoticeProps = {
  message: Message;
  iconId: string;
  title: ReactNode;
  body: Message['body'];
};

const SystemNotice = ({ message, iconId, title, body }: SystemNoticeProps) => {
  return (
    <>
      <NodeContentTitle iconId={iconId}>
        {title}
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
        </dl>
      </div>
    </>
  );
};

export default SystemNotice;
