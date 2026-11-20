import clsx from 'clsx';

import styles from './MessageBubble.module.css';

type MessageBubbleProps = {
  id?: string;
  className?: string;
  direction?: 'incoming' | 'outgoing';
  fullWidth?: boolean;
  highlighted?: boolean;
  pending?: boolean;
  size?: 'small' | 'medium' | 'large';
  timestamp?: React.ReactNode;
  rowActions?: React.ReactNode;
  bubbleActions?: React.ReactNode;
  children: React.ReactNode;
};

const SIZE_CLASSES: Record<NonNullable<MessageBubbleProps['size']>, string> = {
  small: styles.small,
  medium: styles.medium,
  large: styles.large,
};

const MessageBubble = ({
  id,
  className,
  direction = 'outgoing',
  fullWidth = false,
  highlighted = false,
  pending = false,
  size = 'small',
  timestamp,
  rowActions,
  bubbleActions,
  children,
}: MessageBubbleProps) => {
  return (
    <div>
      <div
        id={id}
        className={clsx(
          styles.wrapper,
          className,
          {
            [styles.incoming]: direction === 'incoming',
            [styles.highlighted]: highlighted,
          })
        }
        >
        <div className={clsx(
          styles.bubble,
          SIZE_CLASSES[size],
          {
            [styles.highlighted]: highlighted,
            [styles.pending]: pending,
            [styles.fullWidth]: fullWidth,
          })}
          >
          <div className={styles.messageContent}>{children}</div>
          {timestamp && (
            <div className={styles.timestamp}>{timestamp}</div>
          )}
        </div>
        {rowActions && <div className={styles.rowActions}>{rowActions}</div>}
      </div>
      {bubbleActions && <div className={styles.bubbleActions}>{bubbleActions}</div>}
    </div>
  );
};

export default MessageBubble;
