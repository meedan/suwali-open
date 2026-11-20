import { FormattedMessage, useIntl } from 'react-intl';

import { DEFAULT_TONE, toneDescriptions, toneLabels, tones } from '@helpers/tone';

import FieldHeading from '@ui-components/layout/FieldHeading';
import HintBox from '@ui-components/layout/HintBox';
import RadioCard from '@ui-components/layout/RadioCard';

import styles from './Personalization.module.css';
import { personalizationMessages } from './personalizationSections';

type ResponseStyleFieldProps = {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
};

const ResponseStyleField = ({ value, onChange, error }: ResponseStyleFieldProps) => {
  const intl = useIntl();

  return (
    // The page heading says what the field is, so the visible heading is the instruction. The group is still named for the field
    <fieldset aria-label={intl.formatMessage(personalizationMessages.responseStyle)} className={styles.fieldGroup}>
      <FieldHeading
        label={
          <FormattedMessage
            id="global.responseStyleDescription"
            defaultMessage="Choose how your chatbot should communicate."
            description="Description for response style & tone field"
          />
        }
      />
      <div className={styles.toneOptions}>
        {tones.map((tone) => (
          <RadioCard
            key={tone}
            name="response-style"
            size="large"
            title={
              <>
                <FormattedMessage {...toneLabels[tone]} />
                {tone === DEFAULT_TONE && (
                  <span className={styles.defaultBadge}>
                    <FormattedMessage
                      id="global.default"
                      defaultMessage="Default"
                      description="Label or title for a default status of an item or selection"
                    />
                  </span>
                )}
              </>
            }
            description={<FormattedMessage {...toneDescriptions[tone]} />}
            value={tone}
            selected={value === tone}
            onChange={() => onChange(tone)}
          />
        ))}
      </div>
      {error && <HintBox type="error" body={error} />}
    </fieldset>
  );
};

export default ResponseStyleField;
