import clsx from 'clsx';
import React from 'react';

import styles from './MetaList.module.css';

interface MetaListProps {
  children: React.ReactNode;
  className?: string;
  modal?: boolean;
  secondary?: boolean;
  title?: string;
}

const MetaList = ({ children, className, modal, secondary, title }: MetaListProps) => {
  return (
    <ul title={title} className={clsx(
      styles.metalist,
      className,
      {
        [styles.modal]: modal,
        [styles.secondary]: secondary,
      }
    )}>
      {children}
    </ul>
  );
};

interface MetaListItemProps {
  avatarLayout?: boolean;
  breakList?: boolean;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}

const MetaListItem = ({ children, className, breakList = false, avatarLayout  = false, icon }: MetaListItemProps) => {
  return (
    <li className={clsx(
      className,
      {
        [styles.breakList]: breakList,
        [styles.avatarLayout]: avatarLayout,
      }
    )}>
      {icon && <div className={styles.icon}>{icon}</div>}
      {children}
    </li>
  );
};

MetaList.Item = MetaListItem;

export default MetaList;
