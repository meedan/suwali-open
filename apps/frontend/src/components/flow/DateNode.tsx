import clsx from "clsx";
import { Handle, Position } from "@xyflow/react";

import DatePill from "@ui-components/layout/DatePill";

import styles from "./FlowNode.module.css";

type DateNodeProps = {
  data: {
    date: string;
    isFirst: boolean;
  };
};

// Marks where a new day starts, like the date pill in the conversation view.
// Has no handles, as the line between the messages passes behind it, unless it
// opens the flow, where it is connected to the first message.
const DateNode = ({ data }: DateNodeProps) => (
  <div className={styles.wrapper}>
    <div className={clsx(styles.node, styles.dateSeparator)}>
      <DatePill className={styles.datePill} value={new Date(data.date)} />
      { data.isFirst &&
        <Handle
          id="bottom-source"
          className={styles.bottomSourceHandle}
          type="source"
          position={Position.Bottom}
        />
      }
    </div>
  </div>
);

export default DateNode;
