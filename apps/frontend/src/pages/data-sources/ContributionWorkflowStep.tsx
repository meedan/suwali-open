import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './ContributionWorkflowVisualization.module.css';

type ContributionWorkflowStepProps = {
  icon: string;
  children: React.ReactNode;
  title?: React.ReactNode;
  variant?: 'default' | 'direct' | 'review' | 'error';
  onCustomize?: () => void;
  customizeDisabled?: boolean;
};

const ContributionWorkflowStep = ({
  icon,
  children,
  title,
  variant = 'default',
  onCustomize,
  customizeDisabled,
}: ContributionWorkflowStepProps) => (
  <div
    className={clsx(
      styles.step,
      {
        [styles.errorStep]: variant === 'error',
        [styles.lastStepDirect]: variant === 'direct',
        [styles.lastStepReview]: variant === 'review',
      })
    }
  >
    <Button
      className={clsx(
        {
          [styles.errorStepButton]: variant === 'error',
          [styles.lastStepButtonDirect]: variant === 'direct',
          [styles.lastStepButtonReview]: variant === 'review',
        })
      }
      iconLeft={<Icon aria-hidden id={icon} />}
      size="small"
      style={{ pointerEvents: 'none' }}
      variant="filled"
      themeMode={variant === 'default'}
    />
    <div className={styles.stepContent}>
      {title && <span className={styles.stepTitle}>{title}</span>}
      <span className={styles.stepText}>{children}</span>
      {onCustomize && (
        <Button
          disabled={customizeDisabled}
          label={
            <FormattedMessage
              id="global.customize"
              defaultMessage="Customize"
              description="Reusable label for buttons that open the settings of a contribution workflow step"
            />
          }
          size="small"
          themeMode={customizeDisabled}
          variant="filled"
          onClick={onCustomize}
        />
      )}
    </div>
  </div>
);

export default ContributionWorkflowStep;
