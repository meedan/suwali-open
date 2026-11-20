import { useRef } from 'react';
import { defineMessages, FormattedMessage } from 'react-intl';

import type { ResourceType } from '@customTypes/external-resource';

import { getResourceIcon, resourceTypeLabels, resourceTypes } from '@helpers/externalResource';

import FieldHeading from '@ui-components/layout/FieldHeading';
import Icon from '@ui-components/layout/Icon';
import RadioCard from '@ui-components/layout/RadioCard';

import styles from './Personalization.module.css';

const messages = defineMessages({
  questionExample: {
    id: 'global.resourceTypeQuestionExample',
    defaultMessage: 'Where do I vote?',
    description: 'An example of a question, under the question type of external resource. Example: Where do I vote?',
  },
});

// What each type looks like, under its name. Only the question is words, so only it is translated
const examples: Record<ResourceType, React.ReactNode> = {
  email: 'help@example.com',
  phone: '+1 555 010 0100',
  link: 'https://help.example.com',
  question: <FormattedMessage {...messages.questionExample} />,
};

type ResourceTypePickerProps = {
  // Nothing is chosen until the person chooses, so what they add is always what they said it was
  value: ResourceType | '';
  // Whether it was chosen with a pointer, as opposed to the keyboard, where the next tab goes to what it asks for
  onChange: (type: ResourceType, viaPointer: boolean) => void;
};

// Which kind of resource is being added, which decides what is asked for next
const ResourceTypePicker = ({ value, onChange }: ResourceTypePickerProps) => {
  // The arrow keys move through the types and choose each, so what is chosen cannot take focus away from them
  const viaPointer = useRef(false);

  return (
    // The handlers only note how a type was chosen. The radios inside are the controls
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <fieldset
      aria-labelledby="resource-type-label"
      className={styles.fieldGroup}
      onKeyDown={() => { viaPointer.current = false; }}
      onPointerDown={() => { viaPointer.current = true; }}
    >
      <FieldHeading
        id="resource-type-label"
        label={
          <FormattedMessage
            id="global.resourceTypeLabel"
            defaultMessage="What kind of resource are you adding?"
            description="Label for choosing the type of an external resource: an email address, a phone number, a link or a question"
          />
        }
      />
      <div className={styles.resourceTypeOptions}>
        {resourceTypes.map((type) => (
          <RadioCard
            key={type}
            name="resource-type"
            title={<FormattedMessage {...resourceTypeLabels[type]} />}
            description={
              <span className={styles.resourceTypeExample}>
                <Icon id={getResourceIcon({ resource_type: type, title: '' })} aria-hidden />
                {examples[type]}
              </span>
            }
            value={type}
            selected={value === type}
            onChange={() => onChange(type, viaPointer.current)}
          />
        ))}
      </div>
    </fieldset>
  );
};

export default ResourceTypePicker;
