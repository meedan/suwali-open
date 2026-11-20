import clsx from 'clsx';
import type { CountryCode } from 'libphonenumber-js';
import { useId } from 'react';

import Icon from '@ui-components/layout/Icon';

import { CountrySelect } from './CountrySelect';
import styles from './PhoneInput.module.css';
import TextInput from './TextInput';
import textInputStyles from './TextInput.module.css';

type PhoneInputProps = {
  id?: string;
  label: React.ReactNode;
  helpContent?: React.ReactNode;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  hideCountry?: boolean;
  error?: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  onBlur?: () => void;
  inputProps?: object;
};

// A phone number and the country it is in, as one field: the country is a short picker, showing its flag and dial code,
// beside the number, under one label. Like the label, the help and the error belong to the pair, so they are under the
// whole row. Whether the number is valid is for whoever uses it to say, through `error`.
const PhoneInput = ({
  id,
  label,
  helpContent,
  placeholder,
  value,
  onChange,
  country,
  onCountryChange,
  hideCountry = false,
  error,
  disabled,
  required,
  onBlur,
  inputProps,
}: PhoneInputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    // The label is laid out as a TextInput's large one is, by the same styles, so the pair sits as any other field does
    // The label is marked when the number is wrong, as an input's is, but the border stays on the number alone
    <div className={clsx('base-input-wrapper', textInputStyles.sizeLarge, { 'label-errors': Boolean(error) })}>
      <div className={textInputStyles.titleWrapper}>
        <label className="base-label" htmlFor={inputId}>{label}</label>
      </div>
      <div className={styles.row}>
        {!hideCountry && (
          <CountrySelect
            className={styles.country}
            disabled={disabled}
            value={country}
            onValueChange={onCountryChange}
          />
        )}
        <TextInput
          id={inputId}
          className={clsx(styles.number, { errors: Boolean(error) })}
          disabled={disabled}
          inputProps={inputProps}
          placeholder={placeholder}
          required={required}
          size="large"
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {helpContent && (
        <div className="base-help-container">
          <span>{helpContent}</span>
        </div>
      )}
      {error && (
        <output htmlFor={inputId} className="base-error-container">
          <Icon id="error" aria-hidden />
          <span>{error}</span>
        </output>
      )}
    </div>
  );
};

export default PhoneInput;
