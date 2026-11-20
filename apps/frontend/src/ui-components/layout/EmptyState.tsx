import clsx from 'clsx';

import styles from "./EmptyState.module.css";
import Icon from "./Icon";

type EmptyStateProps = {
  actions?: React.ReactNode;
  className?: string;
  icon?: string;
  layout?: 'block' | 'list';
  message?: string | React.ReactNode;
  size?: 'small' | 'default';
};

const EmptyState = ({
  actions,
  className,
  icon,
  layout = 'block',
  message,
  size = 'default',
}: EmptyStateProps) => (
  <div
    className={clsx(
      [styles.emptyStateWrapper],
      [className],
      {
        [styles.sizeSmall]: size === 'small',
        [styles.layoutList]: layout === 'list',
      })
    }
  >
    {icon && <Icon className={styles.emptyIcon} id={icon} /> }
    {message && <p>{message}</p>}
    {actions &&
      <div className={styles.emptyActions}>
        {actions}
      </div>
    }
  </div>
);

export default EmptyState;
