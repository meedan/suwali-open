import clsx from 'clsx';

type CheckboxProps = {
  // Names the checkbox when there is no label to do it, such as when what the checkbox stands for is shown somewhere else
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  helpContent?: string | React.ReactNode;
  label: React.ReactNode;
  value: string | number;
  checked?: boolean;
  size?: 'small' | 'large';
  themeMode?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const Checkbox = ({
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
  onChange,
}: CheckboxProps) => (
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
          type="checkbox"
          value={value}
          checked={checked}
          onChange={onChange}
          readOnly={!onChange}
        />
        <span>{label}</span>
      </div>
      { helpContent && (
        <div className="base-help-container">
          <span>{helpContent}</span>
        </div>
      )}
    </label>
  </div>
);

export default Checkbox;
