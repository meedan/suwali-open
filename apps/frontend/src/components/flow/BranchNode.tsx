import clsx from "clsx";
import { FormattedMessage } from "react-intl";
import { Handle, Position } from "@xyflow/react";

import type { DataSourcePreviewItem } from "@customTypes/data-source-item";
import type { Message } from "@customTypes/message";

import { useFlowDirection } from "@hooks/useFlowDirection";

import Icon from "@ui-components/layout/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-components/layout/Popover";

import styles from './FlowNode.module.css';
import DataSourceItems from "./node-content/DataSourceItems";
import nodeContentStyles from './node-content/NodeContent.module.css';
import Rewriter from "./node-content/Rewriter";


type BranchNodeTypes = 'data_source_items' | 'rewriter';

type BranchNodeProps = {
  data: {
    type: BranchNodeTypes,
    metadata: Message['metadata'],
    dataSourceItems: DataSourcePreviewItem[],
    isFirst: boolean,
    isLast: boolean,
  },
}

const BranchNode = ({ data }: BranchNodeProps) => {
  const { inlineStart, inlineEnd, popoverSide } = useFlowDirection();
  const icon = {
    data_source_items: <Icon id="database" />,
    rewriter: <Icon id="analyze" />,
  };

  const node = {
    data_source_items: <DataSourceItems dataSourceItems={data.dataSourceItems} />,
    rewriter: <Rewriter metadata={data.metadata} />,
  };

  const actionLabel = {
    data_source_items: (
      <FormattedMessage
        id="global.messageNodeactionDataSourceItems"
        defaultMessage="Query"
        description="Label that represents a diagram node relates to data sources"
      />
    ),
    rewriter: (
      <FormattedMessage
        id="global.messageNodeactionRewriter"
        defaultMessage="Analyze"
        description="Label that represents a diagram node relates to llm processing work"
      />
    ),
  };

  const nodeTitle = {
    data_source_items: (
      <FormattedMessage
        id="global.dataSources"
        defaultMessage="Data sources"
        description="Reusable label for Data Sources page or list title"
      />
    ),
    rewriter: (
      <FormattedMessage
        id="global.userMessage"
        defaultMessage="End-user message"
        description="Reusable label that represents a message originated from the User"
      />
    ),
  };

  return (
    <div className={styles.wrapper}>
      <Popover>
        <PopoverTrigger asChild>
          <div className={clsx([
            styles.node,
            {
              [styles.dataSourceItems]: data.type === 'data_source_items',
              [styles.rewriter]: data.type === 'rewriter',
            }
          ])}>
            <Handle
              id="left-target"
              className={styles.leftTargetHandle}
              type="target"
              position={inlineStart}
            />
            <div className={styles.iconWrapper}>
              { icon[data.type] }
            </div>
            <div className={styles.labelWrapper}>
              <div className={styles.actionLabel}>
                {actionLabel[data.type]}
              </div>
              <div className={styles.nodeTitle}>
                {nodeTitle[data.type]}
              </div>
            </div>
            { data.isLast ?
              <Handle
                id="bottom-source"
                className={styles.bottomSourceHandle}
                type="source"
                position={Position.Bottom}
              />
              :
              <Handle
                id="right-source"
                className={styles.rightSourceHandle}
                type="source"
                position={inlineEnd}
              />
            }
          </div>
        </PopoverTrigger>
        <PopoverContent
          className={clsx([
            nodeContentStyles.nodeContentWrapper,
            {
              [nodeContentStyles.dataSourceItems]: data.type === 'data_source_items',
              [nodeContentStyles.rewriter]: data.type === 'rewriter',
            }
          ])}
          side={popoverSide}
        >
          { node[data.type] }
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default BranchNode;
