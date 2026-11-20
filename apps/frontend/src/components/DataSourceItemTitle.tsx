import clsx from 'clsx';

import type { PriorityTier } from '@customTypes/priority-tier';

import StatusPrefix from '@ui-components/layout/StatusPrefix';

import styles from './DataSourceItemTitle.module.css';
import PriorityTierToggle from './PriorityTierToggle';

type Props = {
  active?: boolean;
  className?: string;
  iconOnly?: boolean;
  onClick?: () => void;
  onTogglePriorityTier?: () => void;
  priorityTier?: PriorityTier;
  singleLine?: boolean;
  syncStatus?: 'pending' | 'error' | 'complete' | 'unsupported';
  title: string;
};

const DataSourceItemTitle = ({ active, className, iconOnly, onClick, onTogglePriorityTier, priorityTier, singleLine, syncStatus, title }: Props) => {
  const statusPrefixes = (
    <>
      {syncStatus === 'pending' && active !== false && <StatusPrefix status="processing" iconOnly={iconOnly} />}
      {syncStatus === 'error' && <StatusPrefix status="error" iconOnly={iconOnly} />}
      {syncStatus === 'unsupported' && <StatusPrefix status="unsupported" iconOnly={iconOnly} />}
      {syncStatus === 'pending' && active === false && <StatusPrefix status="pausing" iconOnly={iconOnly} />}
      {active === false && syncStatus !== 'pending' && <StatusPrefix status="paused" iconOnly={iconOnly} />}
    </>
  );

  return (
    <span className={clsx(styles.dataSourceItemTitle, className)}>
      {priorityTier !== undefined && (
        <PriorityTierToggle disabled={syncStatus === 'pending'} priorityTier={priorityTier} onToggle={onTogglePriorityTier} size="small" />
      )}
      {onClick
        ? <button type="button" className={styles.titleButton} onClick={onClick}>{statusPrefixes}<span className={styles.title}>{title}</span></button>
        : <>{statusPrefixes}<span className={clsx(styles.title, styles.titleStandalone, singleLine && styles.singleLine)}>{title}</span></>
      }
    </span>
  );
};

export default DataSourceItemTitle;
