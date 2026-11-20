import clsx from 'clsx';
import type { HTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';

import styles from './ProgressBar.module.css';

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  label?: string | React.ReactNode;
  fillPercent: number;
  minFillPercent?: number;
}

const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(({
  className,
  fillPercent,
  minFillPercent = 0,
  label,
  ...rest
}, ref) => {
  if (fillPercent < 0 || fillPercent > 100) {
    console.warn(`ProgressBar: fillPercent must be between 0 and 100, got ${fillPercent}`);
  }

  const progressId = useId();
  const clampedPercent = Math.min(100, Math.max(0, fillPercent));
  const displayPercent = clampedPercent > 0 ? Math.max(minFillPercent, clampedPercent) : 0;

  return (
    <div
      ref={ref}
      className={clsx(styles.progressBar, className)}
      {...rest}
    >
      {label && <label htmlFor={progressId}>{label}</label>}
      <progress id={progressId} value={displayPercent} max={100} />
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

export default ProgressBar;
