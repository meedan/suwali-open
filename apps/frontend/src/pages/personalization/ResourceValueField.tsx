import type { CountryCode } from 'libphonenumber-js';
import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { ResourceType } from '@customTypes/external-resource';

import { isValidEmail, isValidPhone, resourceTypeLabels } from '@helpers/externalResource';

import PhoneInput from '@ui-components/input/PhoneInput';
import TextInput from '@ui-components/input/TextInput';
import UrlInput from '@ui-components/input/UrlInput';
import CharacterCount from '@ui-components/layout/CharacterCount';

import { personalizationFormMessages } from './personalizationFormMessages';

const messages = defineMessages({
  emailPlaceholder: {
    id: 'global.resourceEmailPlaceholder',
    defaultMessage: 'e.g., support@company.com',
    description: 'Placeholder for the email address of an external resource',
  },
  linkPlaceholder: {
    id: 'global.resourceLinkPlaceholder',
    defaultMessage: 'e.g., https://help.example.com',
    description: 'Placeholder for the link of an external resource',
  },
  questionPlaceholder: {
    id: 'global.resourceQuestionPlaceholder',
    defaultMessage: 'e.g., Where do I vote?',
    description: 'Placeholder for the question of an external resource',
  },
  phonePlaceholder: {
    id: 'global.resourcePhonePlaceholder',
    defaultMessage: 'e.g., 555 010 0100',
    description: 'Placeholder for the phone number of an external resource, typed without the country code',
  },
});

type ResourceValueFieldProps = {
  type: ResourceType;
  value: string;
  onChange: (value: string) => void;
  // Used for phone numbers, which are typed for a country
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  maxQuestionLength?: number;
  // What went wrong saving, shown when what was typed is fine
  error: string | null;
};

// What to ask for when a field is left empty
const requiredMessages = {
  email: personalizationFormMessages.resourceEmailRequired,
  phone: personalizationFormMessages.resourcePhoneRequired,
  link: personalizationFormMessages.resourceLinkRequired,
  question: personalizationFormMessages.resourceQuestionRequired,
};

// These are not the person's own details, so the browser is not to offer theirs
const notOwnDetails = { autoComplete: 'off', autoCapitalize: 'none', spellCheck: false };

// What to ask for once the type of resource is known: an email address, a phone number in a country, a link or free text
const ResourceValueField = ({ type, value, onChange, country, onCountryChange, maxQuestionLength, error }: ResourceValueFieldProps) => {
  const intl = useIntl();

  // What was typed is only called wrong once the person has left the field, and not while they are still typing it
  const [touched, setTouched] = useState(false);
  const hasValue = value.trim().length > 0;
  const label = <FormattedMessage {...resourceTypeLabels[type]} />;
  // An empty field is called wrong once it has been left, or once what was typed has been cleared
  const emptyError = touched && !hasValue ? <FormattedMessage {...requiredMessages[type]} /> : null;
  const handleChange = (next: string) => {
    if (next.trim() === '') setTouched(true);
    onChange(next);
  };

  if (type === 'question') {
    return (
      <TextInput
        id="external-resource-value"
        label={label}
        placeholder={intl.formatMessage(messages.questionPlaceholder)}
        helpContent={maxQuestionLength !== undefined && <CharacterCount count={value.length} max={maxQuestionLength} />}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setTouched(true)}
        // A question is words, so spelling is checked and capitals are as typed
        inputProps={{ autoComplete: 'off', maxLength: maxQuestionLength }}
        error={emptyError ?? error}
        size="large"
        required
      />
    );
  }

  if (type === 'phone') {
    const isInvalid = touched && hasValue && !isValidPhone(value, country);

    return (
      <PhoneInput
        id="external-resource-value"
        label={label}
        placeholder={intl.formatMessage(messages.phonePlaceholder)}
        value={value}
        onChange={handleChange}
        country={country}
        onCountryChange={onCountryChange}
        onBlur={() => setTouched(true)}
        inputProps={{ inputMode: 'tel', ...notOwnDetails }}
        error={isInvalid ? (
          <FormattedMessage
            id="global.resourceInvalidPhone"
            defaultMessage="This does not look like a valid phone number."
            description="Error shown when the phone number of an external resource is not a plausible number"
          />
        ) : emptyError ?? error}
        required
      />
    );
  }

  if (type === 'link') {
    return (
      <UrlInput
        id="external-resource-value"
        label={label}
        placeholder={intl.formatMessage(messages.linkPlaceholder)}
        value={value}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        inputProps={notOwnDetails}
        error={emptyError ?? error}
        size="large"
        required
      />
    );
  }

  const isInvalid = touched && hasValue && !isValidEmail(value.trim());

  return (
    <TextInput
      id="external-resource-value"
      label={label}
      placeholder={intl.formatMessage(messages.emailPlaceholder)}
      type="email"
      inputProps={notOwnDetails}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      // Leaving the field tidies what was typed, as the web address field does
      onBlur={() => {
        setTouched(true);
        onChange(value.trim());
      }}
      error={isInvalid ? (
        <FormattedMessage
          id="global.resourceInvalidEmail"
          defaultMessage="This does not look like a valid email address."
          description="Error shown when the email address of an external resource is not a plausible address"
        />
      ) : emptyError ?? error}
      size="large"
      required
    />
  );
};

export default ResourceValueField;
