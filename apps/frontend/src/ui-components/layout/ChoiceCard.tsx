import clsx from 'clsx';

import Checkbox from '@ui-components/input/Checkbox';
import RadioButton from '@ui-components/input/RadioButton';

import styles from './ChoiceCard.module.css';

export type ChoiceCardBaseProps = {
  // Names the input when the card has no title, such as when what it shows is in children, which are outside the input's label
  ariaLabel?: string;
  children?: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  id?: string;
  selected?: boolean;
  size?: 'small' | 'large';
  title?: React.ReactNode;
  value?: string | number;
  // Called when the card is chosen, or for a checkbox, also when it is cleared
  onChange?: () => void;
};

type ChoiceCardProps = ChoiceCardBaseProps & (
  | { type: 'checkbox'; name?: never }
  // Cards that share a name are one group of radios, which is reached as a single tab stop and moved through with the arrow keys
  | { type: 'radio'; name: string }
);

// The card behind CheckboxCard and RadioCard, which are what to use. It keeps them looking and behaving the same.
// The input is the control, so a keyboard or screen reader meets one native checkbox or radio. Its label is stretched
// over the card in the stylesheet so a click anywhere on the card reaches it
const ChoiceCard = ({
  ariaLabel,
  children,
  className,
  description,
  disabled = false,
  icon,
  id,
  name,
  selected = false,
  size = 'small',
  title,
  type,
  value,
  onChange,
}: ChoiceCardProps) => {
  const inputProps = {
    ariaLabel,
    className: styles.choiceCardInput,
    checked: selected,
    disabled,
    helpContent: description,
    id,
    label: title,
    size,
    onChange: () => onChange?.(),
  };

  return (
    <div
      className={clsx(
        styles.choiceCard,
        className,
        {
          [styles.noTitle]: !title,
          [styles.selected]: selected,
          // css-modules-allow-undefined: small is the default size, so it has no styles
          [styles.sizeSmall]: size === 'small',
          [styles.sizeLarge]: size === 'large',
        },
      )}
    >
      {icon && <div className={styles.icon}>{icon}</div>}
      {type === 'radio'
        ? <RadioButton {...inputProps} name={name} value={value} />
        : <Checkbox {...inputProps} value={value ?? ''} />
      }
      {children &&
        // Sits above the stretched label so what is in it can be used, and a click on it still changes the card, as a
        // click on the input would: not when it is disabled, or a radio that is already chosen.
        // Only a convenience for the mouse, the input above is what a keyboard uses
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div className={styles.choiceCardContent} onClick={disabled || (type === 'radio' && selected) ? undefined : () => onChange?.()}>
          {children}
        </div>
      }
    </div>
  );
};

export default ChoiceCard;
