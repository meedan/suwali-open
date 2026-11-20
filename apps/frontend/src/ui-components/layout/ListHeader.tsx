import clsx from 'clsx';
import { useState } from 'react';

import EditableTitle from '@components/EditableTitle';

import styles from './ListHeader.module.css';

type ListHeaderProps = {
  alignment?: 'start' | 'center';
  actionLeft?: React.ReactNode;
  actionRight?: React.ReactNode;
  caption?: string | React.ReactNode;
  className?: string;
  count?: number;
  sticky?: boolean;
  title?: string | React.ReactNode;
  onSubmitTitle?: (newTitle: string) => void;
};

const ListHeader = ({
  alignment = 'center',
  actionLeft,
  actionRight,
  caption,
  className,
  count,
  sticky,
  title,
  onSubmitTitle,
}: ListHeaderProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const titleString = typeof title === 'string' ? title : '';
  const displayValue = count != null ? <>{title} ({count})</> : title;

  return (
    <header
      className={clsx(
        styles.listHeaderWrapper,
        className,
        {
          [styles.alignmentCenter]: alignment === 'center',
          [styles.alignmentStart]: alignment === 'start',
          [styles.stickyHeader]: sticky,
          [styles.hasActionLeft]: actionLeft,
          [styles.hasActionRight]: actionRight,
          [styles.editingTitle]: isEditing,
        })
      }
    >
      {actionLeft &&
        <div className={styles.actionLeftWrapper}>
          {actionLeft}
        </div>
      }
      <EditableTitle
        canEdit={!!onSubmitTitle}
        displayValue={displayValue}
        onEditingChange={setIsEditing}
        onSave={onSubmitTitle ?? (() => {})}
        renderMeta={caption && <span className={styles.caption}>{caption}</span>}
        size="small"
        value={titleString}
      />
      {actionRight &&
        <div className={styles.actionRightWrapper}>
          {actionRight}
        </div>
      }
    </header>
  );
};

export default ListHeader;
