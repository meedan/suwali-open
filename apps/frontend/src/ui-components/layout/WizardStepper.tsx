import clsx from "clsx";

import Icon from "./Icon";
import styles from "./WizardStepper.module.css";

type WizardStepperProps = {
  currentStep: number;
  steps: { label: React.ReactNode; description: React.ReactNode }[];
  title?: string | React.ReactNode;
  heading?: { icon: string; label: React.ReactNode };
};

const WizardStepper = ({
  currentStep,
  steps,
  title,
  heading,
}: WizardStepperProps) => {
  return (
    <div className={styles.wizardStepper}>
      {heading ? (
        <h2 className={styles.heading}>
          <Icon id={heading.icon} aria-hidden />
          {heading.label}
        </h2>
      ) : title && <h2>{title}</h2> }
      <ul className={styles.timeline}>
        {steps.map((step, index) => (
          <li
            className={clsx([
              {
                [styles.passed]: index < currentStep,
                [styles.active]: index === currentStep,
                [styles.future]: index > currentStep,
              }
            ])}
            key={index}
          >
            <div className={styles.stepIndicator}>
              <Icon id="check_filled" className={styles.checkIcon} />
            </div>
            <strong>{step.label}</strong>
            {step.description}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WizardStepper;
