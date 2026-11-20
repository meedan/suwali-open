import clsx from 'clsx';

import Icon from '@ui-components/layout/Icon';

import styles from './OnboardingSteps.module.css';

export const DoneStep = ({ label }: { label: React.ReactNode }) => (
  <div className={styles.stepDone}>
    <span className={styles.stepCountDone}>
      <Icon id="check" aria-hidden />
    </span>
    <h5>{label}</h5>
  </div>
);

export const CurrentStep = ({
  className,
  step,
  label,
  children
}: { className?: string; step?: string; label: React.ReactNode; children?: React.ReactNode; }) => (
  <section
    className={clsx(
      [styles.stepCurrent],
      [className],
    )}
  >
    <hgroup>
      {step && <span className={styles.stepCount}>{step}</span>}
      <h5>{label}</h5>
    </hgroup>
    {children}
  </section>
);

export const FutureStep = ({ step, label }: { step: string; label: React.ReactNode }) => (
  <div className={styles.stepFuture}>
    <span className={styles.stepCount}>{step}</span>
    <h5>{label}</h5>
  </div>
);
