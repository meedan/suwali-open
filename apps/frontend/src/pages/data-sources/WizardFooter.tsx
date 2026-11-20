import { FormattedMessage } from "react-intl";

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";

import styles from "./Wizard.module.css";

type WizardFooterProps = {
  completeLabel?: React.ReactNode;
  disableNext?: boolean;
  disableComplete?: boolean;
  isEditing?: boolean;
  leftAction?: React.ReactNode;
  onCancel?: () => void;
  onGoBack?: () => void;
  onGoNext?: () => void;
  onComplete?: () => void;
};

const WizardStepFooter = ({
  completeLabel,
  disableNext,
  disableComplete,
  isEditing,
  leftAction,
  onCancel,
  onGoBack,
  onGoNext,
  onComplete,
}: WizardFooterProps) => {
  const cancelButton = (
    <Button
      label={
        isEditing ? (
          <FormattedMessage
            id="global.cancel"
            defaultMessage="Cancel"
            description="Reusable label for cancel buttons"
          />
        ) : (
          <FormattedMessage
            id="global.startOver"
            defaultMessage="Start over"
            description="Button label to restart the wizard from the beginning"
          />
        )
      }
      size="small"
      themeMode
      variant="text"
      onClick={onCancel}
    />
  );

  return (
    <footer className={styles.wizardCardFooter}>
      { leftAction || onCancel && onGoBack && cancelButton }
      <div className={styles.wizardCardFooterNavigation}>
        { onCancel && !onGoBack && cancelButton }
        { onGoBack && (
          <Button
            iconLeft={<Icon id="chevron_left" />}
            label={
              <FormattedMessage
                id="global.back"
                defaultMessage="Back"
                description="Button label for going back to the previous step in a wizard"
              />
            }
            size="small"
            themeMode
            variant="text"
            onClick={onGoBack}
          />
        )}
        { onGoNext && (
          <Button
            iconRight={<Icon id="chevron_right" />}
            variant="filled"
            label={
              <FormattedMessage
                id="global.continue"
                defaultMessage="Continue"
                description="Primary action button label to continue after completing form data"
              />
            }
            size="small"
            onClick={onGoNext}
            disabled={disableNext}
          />
        )}
        { onComplete && (
          <Button
            iconLeft={<Icon id="check" />}
            variant="filled"
            label={
              completeLabel ?? (
                isEditing ? (
                  <FormattedMessage
                    id="global.saveSetup"
                    defaultMessage="Save setup"
                    description="Button label for saving the data source setup"
                  />
                ) : (
                  <FormattedMessage
                    id="global.addSource"
                    defaultMessage="Add source"
                    description="Button label for completing the data source setup"
                  />
                )
              )
            }
            size="small"
            onClick={onComplete}
            disabled={disableComplete}
          />
        )}
      </div>
    </footer>
  );
};

export default WizardStepFooter;
