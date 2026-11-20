import clsx from 'clsx';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './Chip.module.css';

type ChipProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  clickLabel?: string;
  clickTooltip?: React.ReactNode;
  pressed?: boolean;
  opensDialog?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  removeTooltip?: React.ReactNode;
};

const Chip = ({ children, className, onClick, clickLabel, clickTooltip, pressed, opensDialog, onRemove, removeLabel, removeTooltip }: ChipProps) => {
  const removeButton = onRemove && (
    <Button aria-label={removeLabel} className={styles.remove} size="small" themeMode onClick={onRemove} iconLeft={<Icon id="x" aria-hidden />} />
  );

  const label = onClick ? (
    <Button aria-haspopup={opensDialog ? 'dialog' : undefined} aria-label={clickLabel} aria-pressed={pressed} className={styles.label} themeMode onClick={onClick} size="small" label={children} />
  ) : children;

  return (
    <span
      className={clsx(
        styles.chip,
        removeButton && styles.removeable,
        onClick && styles.clickable,
        className
      )}
    >
      {onClick && clickTooltip ? <Tooltip content={clickTooltip}>{label}</Tooltip> : label}
      {removeButton && (removeTooltip ? <Tooltip content={removeTooltip}>{removeButton}</Tooltip> : removeButton)}
    </span>
  );
};

export default Chip;
