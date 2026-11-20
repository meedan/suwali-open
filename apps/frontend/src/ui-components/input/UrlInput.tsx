import { useState } from 'react';
import { FormattedMessage } from 'react-intl';

import { normalizeUrl } from '@helpers/forms';

import TextInput from './TextInput';

type UrlInputProps = {
  id?: string;
  label?: React.ReactNode;
  helpContent?: React.ReactNode;
  placeholder?: string;
  value: string;
  // Called with what was typed, and again with the tidied address when the field is left
  onChange: (value: string) => void;
  // Another problem to show, such as one from the server, when what was typed is fine
  error?: React.ReactNode;
  // Called when the field is left, after the address has been tidied
  onBlur?: () => void;
  disabled?: boolean;
  required?: boolean;
  size?: 'small' | 'large';
  // More attributes for the input, such as turning autofill off
  inputProps?: object;
};

// A text input for a web address. Leaving the field tidies what was typed, adding https:// when it has no scheme, and
// says so when it is not an address. The value is only called wrong once the field has been left, and stops being
// as soon as it is right, so the error never outlasts what caused it. Whether the value can be used is `normalizeUrl(value)`.
const UrlInput = ({ value, onChange, onBlur, error, inputProps, ...props }: UrlInputProps) => {
  const [touched, setTouched] = useState(false);

  const normalized = normalizeUrl(value);
  const isInvalid = touched && value.trim() !== '' && normalized === null;

  const handleBlur = () => {
    setTouched(true);
    const tidied = normalized ?? value.trim();
    if (tidied !== value) onChange(tidied);
    onBlur?.();
  };

  return (
    <TextInput
      {...props}
      type="url"
      // An address is not words to correct or to start with a capital
      inputProps={{ spellCheck: false, autoCapitalize: 'none', ...inputProps }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={handleBlur}
      error={isInvalid ? (
        <FormattedMessage
          id="global.invalidUrlError"
          defaultMessage="Invalid URL"
          description="Error message shown when user inputs an invalid url"
        />
      ) : error}
    />
  );
};

export default UrlInput;
