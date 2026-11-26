import clsx from 'clsx';
import React from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip.tsx';

import styles from './TextInput.module.css';

const messages = defineMessages({
  clearSearch: {
    id: 'global.clearSearch',
    defaultMessage: 'Clear search',
    description: 'Reusable label for the button that empties a search field',
  },
});

interface TextInputProps {
  id?: string;
  autoComplete?: 'username' | 'current-password' | 'new-password';
  autoFocus?: boolean;
  label?: string | React.ReactNode;
  labelContext?: string | React.ReactNode;
  helpContent?: string | React.ReactNode;
  placeholder?: string;
  value: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  error?: React.ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  className?: string;
  size?: 'small' | 'large';
  type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'date' | 'search';
  inputProps?: object;
  // A short, non-editable value (e.g. a phone country code) shown inside the input, before its
  // editable content, so the person doesn't need to type it themselves or duplicate it.
  prefix?: React.ReactNode;
  // Shows a button that empties a search field once something is typed; the browser's own one is hidden
  onClear?: () => void;
}

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(({
  id,
  autoComplete,
  autoFocus,
  label,
  labelContext,
  helpContent,
  placeholder,
  value,
  onChange,
  onKeyDown,
  onBlur,
  onFocus,
  error,
  disabled,
  readOnly,
  required,
  className,
  inputProps,
  size = 'small',
  type = 'text',
  prefix,
  onClear,
}, ref) => {
  const intl = useIntl();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isSearch = type === 'search';

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  return (
    <div
      className={clsx(
        'base-input-wrapper',
        [className],
        {
          disabled: disabled,
          errors: error,
          [styles.prefix]: prefix || isSearch,
          [styles.search]: isSearch,
          // css-modules-allow-undefined: small is the default size, so it has no styles
          [styles.sizeSmall]: size === 'small',
          [styles.sizeLarge]: size === 'large',
        })
      }
    >
      {label &&
        <div className={styles.titleWrapper}>
          <label className="base-label" htmlFor={id}>{label}</label>
          {labelContext &&
            <div className="base-label-context">
              {labelContext}
            </div>
          }
        </div>
      }
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={clsx('base-input', 'base-input-row', styles.inputRow)}
        onClick={() => inputRef.current?.focus()}
      >
        {isSearch && <span key="searchIcon" className={styles.searchIcon}><Icon id="magnifying_glass" aria-hidden /></span>}
        {prefix && <span key="prefix" className="base-input-prefix">{prefix}</span>}
        <input
          key="input"
          ref={setRefs}
          id={id}
          autoFocus={autoFocus} // eslint-disable-line jsx-a11y/no-autofocus
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onFocus={onFocus}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          autoComplete={autoComplete}
          {...inputProps}
        />
        {isSearch && onClear && value !== '' && (
          <div key="clear" className={styles.clear}>
            <Tooltip
              content={
                <FormattedMessage
                  id="global.clearSearch"
                  defaultMessage="Clear search"
                  description="Reusable label for the button that empties a search field"
                />
              }
            >
              <Button
                aria-label={intl.formatMessage(messages.clearSearch)}
                iconLeft={<Icon id="x" aria-hidden />}
                size="small"
                themeMode
                variant="filled"
                onClick={() => {
                  onClear();
                  inputRef.current?.focus();
                }}
              />
            </Tooltip>
          </div>
        )}
      </div>
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

export default TextInput;
