import clsx from 'clsx';

import styles from './HintBox.module.css';
import Icon from './Icon';

type HintBoxProps = {
  className?: string;
  iconId?: string;
  type: 'info' | 'error' | 'success' | 'warning' | 'themeMode';
  title?: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  noIcon?: boolean;
  size?: 'small' | 'large';
};

const iconMap = {
  info: 'lightbulb',
  error: 'error',
  success: 'check_seal_filled',
  warning: 'error',
  themeMode: 'info',
};

const HintBox = ({
  className,
  iconId,
  type,
  title,
  body,
  actions,
  noIcon = false,
  size = 'small',
}: HintBoxProps) => {
  return (
    <div className={clsx(
      className,
      styles.hintBoxWrapper,
      {
        [styles.info]: type === 'info',
        [styles.error]: type === 'error',
        [styles.success]: type === 'success',
        [styles.warning]: type === 'warning',
        [styles.theme]: type === 'themeMode',
        [styles.sizeSmall]: size === 'small',
        [styles.sizeLarge]: size === 'large',
      }
    )}>
      { !noIcon && <Icon id={iconId || iconMap[type]} className={styles.hintBoxIcon} aria-hidden /> }
      <div className={styles.hintBoxContent}>
        {title && (
          <div className={styles.hintBoxTitle}>
            {title}
          </div>
        )}
        {body && (
          <div className={styles.hintBoxBody}>
            {body}
          </div>
        )}
        {actions && (
          <div className={styles.hintBoxActions}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

export default HintBox;
