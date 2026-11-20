import clsx from 'clsx';
import React from 'react';

import Icon from '@ui-components/layout/Icon';

import styles from './TextInput.module.css';

interface TextAreaProps {
  id?: string;
  autoFocus?: boolean;
  autoGrow?: boolean;
  // Names the field when the visible label does not, e.g. when it is an instruction and not the field's name
  'aria-label'?: string;
  label?: string | React.ReactNode;
  helpContent?: string | React.ReactNode;
  placeholder?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  error?: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  size?: 'small' | 'large';
  rows?: number;
  maxLength?: number;
}

const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(({
  id,
  autoFocus,
  autoGrow = false,
  'aria-label': ariaLabel,
  label,
  helpContent,
  placeholder,
  value,
  onChange,
  onKeyDown,
  onBlur,
  onFocus,
  error,
  disabled,
  required,
  className,
  size = 'small',
  rows = 7,
  maxLength,
}, ref) => {
  return (
    <div
      className={clsx(
        'base-input-wrapper',
        [className],
        {
          [styles.autoGrow]: autoGrow,
          disabled: disabled,
          errors: error,
          // css-modules-allow-undefined: small is the default size, so it has no styles
          [styles.sizeSmall]: size === 'small',
          [styles.sizeLarge]: size === 'large',
        })
      }
      data-textarea-value={autoGrow ? value : undefined}
    >
      {label &&
        <div className={styles.titleWrapper}>
          <label className="base-label" htmlFor={id}>{label}</label>
        </div>
      }
      <textarea
        id={id}
        aria-label={ariaLabel}
        autoFocus={autoFocus} // eslint-disable-line jsx-a11y/no-autofocus
        className="base-input"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        disabled={disabled}
        ref={ref}
        required={required}
        maxLength={maxLength}
        rows={autoGrow ? 1 : rows} // Use 1 row as base when auto-growing
      />
      { helpContent && (
        <div className="base-help-container">
          <span>{helpContent}</span>
        </div>
      )}
      { error && (
        <output htmlFor={id} className="base-error-container">
          <Icon id="error" aria-hidden />
          <span>{error}</span>
        </output>
      )}
    </div>
  );
});

export default TextArea;
