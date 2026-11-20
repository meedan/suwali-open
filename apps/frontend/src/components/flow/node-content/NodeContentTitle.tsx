import type { ReactNode } from "react";

import Icon from "@ui-components/layout/Icon";

import styles from "./NodeContent.module.css";

type NodeContentTitleProps = {
  iconId: string;
  children: ReactNode;
};

const NodeContentTitle = ({ iconId, children }: NodeContentTitleProps) => (
  <div className={styles.nodeContentTitle}>
    <Icon id={iconId} />
    {children}
  </div>
);

export default NodeContentTitle;
