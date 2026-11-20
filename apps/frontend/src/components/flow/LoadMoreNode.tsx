import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';
import { Handle, Position } from '@xyflow/react';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './FlowNode.module.css';

type LoadMoreNodeProps = {
  data: {
    direction: 'earlier' | 'newer';
    loading: boolean;
    onClick: () => void;
  };
};

// Caps an end of the flow that has more messages to load, connected to the
// message next to it, so the flow doesn't look complete when it isn't.
const LoadMoreNode = ({ data: { direction, loading, onClick } }: LoadMoreNodeProps) => (
  <div className={styles.wrapper}>
    <div className={clsx(styles.node, styles.loadMore)}>
      { direction === 'newer' &&
        <Handle
          className={styles.topTargetHandle}
          type="target"
          position={Position.Top}
        />
      }
      <Button
        disabled={loading}
        iconLeft={direction === 'earlier' && <Icon id="chevron_up_filled" aria-hidden />}
        iconRight={direction === 'newer' && <Icon id="chevron_down_filled" aria-hidden />}
        label={
          loading ? (
            <FormattedMessage
              id="global.loadingMore"
              defaultMessage="Loading more…"
              description="Message shown when loading more items"
            />
          ) : direction === 'earlier' ? (
            <FormattedMessage
              id="global.loadEarlierMessages"
              defaultMessage="Load earlier messages"
              description="Reusable label for a button that loads older messages of a conversation"
            />
          ) : (
            <FormattedMessage
              id="global.loadNewerMessages"
              defaultMessage="Load newer messages"
              description="Reusable label for a button that loads more recent messages of a conversation"
            />
          )
        }
        size="small"
        themeMode
        orientation="vertical"
        onClick={onClick}
      />
      { direction === 'earlier' &&
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

export default LoadMoreNode;
