import clsx from 'clsx';

type RadioButtonProps = {
  // Names the radio when there is no label to do it, such as when what the radio stands for is shown somewhere else
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  helpContent?: string | React.ReactNode;
  label?: React.ReactNode;
  value?: string | number;
  checked?: boolean;
  size?: 'small' | 'large';
  themeMode?: boolean;
  name?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const RadioButton = ({
  ariaLabel,
  id,
  className,
  disabled = false,
  helpContent,
  label,
  value,
  checked = false,
  size = 'small',
  themeMode,
  name,
  onChange,
}: RadioButtonProps) => (
  <div
    className={clsx(
      'base-input-wrapper',
      'check-wrapper',
      [className],
      {
        'theme-mode': themeMode,
        disabled: disabled,
        'size-small': size === 'small',
        'size-large': size === 'large',
      })
    }
  >
    <label className="base-label" htmlFor={id}>
      <div>
        <input
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          type="radio"
          value={value}
          checked={checked}
          name={name}
          onChange={onChange}
          readOnly={!onChange}
        />
        { label && <span>{label}</span> }
      </div>
      { helpContent && (
        <div className="base-help-container">
          <span>{helpContent}</span>
        </div>
      )}
    </label>
  </div>
);

export default RadioButton;
