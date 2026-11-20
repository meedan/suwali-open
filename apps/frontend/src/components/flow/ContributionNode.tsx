import clsx from "clsx";
import { FormattedMessage } from "react-intl";
import { Handle, Position } from "@xyflow/react";

import type { Message } from '@customTypes/message';

import { useMessageHighlight } from "@contexts/MessageSelectContext";

import { useFlowDirection } from "@hooks/useFlowDirection";

import Icon from "@ui-components/layout/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-components/layout/Popover";

import styles from './FlowNode.module.css';
import ContributionMessage from "./node-content/ContributionMessage";
import nodeContentStyles from './node-content/NodeContent.module.css';

type ContributionNodeProps = {
  data: {
    id: Message['id'],
    body: Message['body'],
    type: 'bot_contribution_started' | 'user_contribution_cancelled' | 'user_contribution_submitted',
    isFirst: boolean,
    isLast: boolean,
    hasBranch: boolean,
    metadata: Message['metadata'],
    messageObject: Message,
    branchIndex?: number,
    parentId?: string,
  },
}

const ICON_MAP = {
  bot_contribution_started: <Icon id="play" />,
  user_contribution_cancelled: <Icon id="x" />,
  user_contribution_submitted: <Icon id="check" />,
};

const ACTION_LABELS = {
  bot_contribution_started: (
    <FormattedMessage
      id="messageNode.contributionStart"
      defaultMessage="Confirm"
      description="Label for contribution started action"
    />
  ),
  user_contribution_cancelled: (
    <FormattedMessage
      id="messageNode.contributionCancel"
      defaultMessage="Cancel"
      description="Label for contribution cancelled action"
    />
  ),
  user_contribution_submitted: (
    <FormattedMessage
      id="messageNode.contributionSubmit"
      defaultMessage="Submit"
      description="Label for contribution submitted action"
    />
  ),
};

const CONTRIBUTION_TITLE = {
  bot_contribution_started: (
    <FormattedMessage
      id="global.readyMessage"
      defaultMessage="Ready"
      description="Label that represents a ready message"
    />
  ),
  user_contribution_cancelled: (
    <FormattedMessage
      id="global.contributionMessage"
      defaultMessage="Contribution"
      description="Label that represents a contribution message"
    />
  ),
  user_contribution_submitted: (
    <FormattedMessage
      id="global.contributionMessage"
      defaultMessage="Contribution"
      description="Label that represents a contribution message"
    />
  ),
};

const ContributionNode = ({ data }: ContributionNodeProps) => {
  const { inlineStart, inlineEnd, popoverSide } = useFlowDirection();
  const { highlightMessageId, selectMessageHighlight } = useMessageHighlight();
  const getDetails = () => {
    switch (data.type) {
      case 'bot_contribution_started':
        return <ContributionMessage message={data.messageObject} body={data.body} type="started" origin="bot" />;
      case 'user_contribution_cancelled':
        return <ContributionMessage message={data.messageObject} body={data.body} type="cancelled" origin="user" />;
      case 'user_contribution_submitted':
        return <ContributionMessage message={data.messageObject} body={data.body} type="submitted" origin="user" />;
    }
  };

  return (
    <div className={styles.wrapper}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={clsx([
              styles.node,
              styles.contribution,
              { [styles.highlighted]: highlightMessageId === data.id },
            ])}
            aria-pressed={highlightMessageId === data.id}
            onClick={() => selectMessageHighlight(data.id)}
          >
            <Handle
              id="left-target"
              className={styles.leftTargetHandle}
              type="target"
              position={inlineStart}
            />
            <>
              <div className={styles.iconWrapper}>
                {ICON_MAP[data.type]}
              </div>
              <div className={styles.labelWrapper}>
                <div className={styles.actionLabel}>
                  {ACTION_LABELS[data.type]}
                </div>
                <div className={styles.nodeTitle}>
                  {CONTRIBUTION_TITLE[data.type]}
                </div>
              </div>
            </>
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
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={clsx([
            nodeContentStyles.nodeContentWrapper,
            nodeContentStyles.contribution,
          ])}
          side={popoverSide}
        >
          {getDetails()}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default ContributionNode;
