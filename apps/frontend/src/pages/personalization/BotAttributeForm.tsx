import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { BotAttributes } from '@customTypes/hub';

import { getPersonalizationIcon } from "@helpers/source";
import { DEFAULT_TONE } from '@helpers/tone';

import { updateBotAttributes } from '@services/HubService';

import TextArea from '@ui-components/input/TextArea';
import TextInput from '@ui-components/input/TextInput';
import Icon from '@ui-components/layout/Icon';

import styles from './Personalization.module.css';
import PersonalizationFormFooter from './PersonalizationFormFooter';
import { personalizationFormMessages } from './personalizationFormMessages';
import { personalizationMessages } from './personalizationSections';
import ResponseStyleField from './ResponseStyleField';

const messages = defineMessages({
  chatbotNamePlaceholder: {
    id: 'global.chatbotNamePlaceholder',
    defaultMessage: 'e.g., Organization name',
    description: 'Placeholder for the field where the chatbot’s name is entered',
  },
  roleDescriptionPlaceholder: {
    id: 'global.roleDescriptionPlaceholder',
    defaultMessage: 'e.g., This chatbot answers questions about our programs, events and how to get involved.',
    description: 'Placeholder for the field where the chatbot’s role and description is entered',
  },
});

export type BotAttributeType = 'chatbotName' | 'roleDescription' | 'responseStyle';

// What each single-value attribute is stored as, how it is called, and the buttons that set it and save changes to it
const attributes = {
  chatbotName: { attributeKey: 'name', label: personalizationMessages.chatbotName, addLabel: personalizationFormMessages.chatbotNameAdd, saveLabel: personalizationFormMessages.chatbotNameSave },
  roleDescription: { attributeKey: 'description', label: personalizationMessages.roleDescription, addLabel: personalizationFormMessages.roleDescriptionAdd, saveLabel: personalizationFormMessages.roleDescriptionSave },
  responseStyle: { attributeKey: 'tone', label: personalizationMessages.responseStyle, addLabel: personalizationFormMessages.responseStyleAdd, saveLabel: personalizationFormMessages.responseStyleSave },
} as const;

type BotAttributeFormProps = {
  attributeType: BotAttributeType;
  hubId: number | string | null;
  currentBotAttributes?: BotAttributes;
  hasSavedValue?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
  onCancel?: () => void;
};

const BotAttributeForm = ({
  attributeType,
  hubId,
  currentBotAttributes = {},
  hasSavedValue = false,
  onSuccess,
  onError,
  onCancel,
}: BotAttributeFormProps) => {
  const intl = useIntl();

  const stored = {
    chatbotName: currentBotAttributes.name,
    roleDescription: currentBotAttributes.description,
    responseStyle: currentBotAttributes.tone,
  }[attributeType];

  // Response style falls back to a default when nothing is stored, so there is then nothing to remove
  const canRemove = hasSavedValue && Boolean(stored);

  const savedValue = hasSavedValue ? {
    chatbotName: currentBotAttributes.name || '',
    roleDescription: currentBotAttributes.description || '',
    responseStyle: currentBotAttributes.tone || DEFAULT_TONE,
  }[attributeType] : '';

  const [value, setValue] = useState(savedValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { attributeKey, label, addLabel, saveLabel } = attributes[attributeType];

  const handleSubmit = async () => {
    if (!value.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateBotAttributes(
        hubId!,
        {
          ...currentBotAttributes,
          [attributeKey]: value,
        },
      );
      onSuccess?.();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
      onError?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDirty = value !== savedValue;

  // Editing an existing value, cancelling means going back to what was saved
  const handleCancel = () => {
    setError(null);
    if (hasSavedValue) {
      setValue(savedValue);
    } else {
      setValue('');
      onCancel?.();
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    setError(null);

    // Create a new bot_attributes object without the current attribute
    const updatedAttributes = { ...currentBotAttributes };
    delete updatedAttributes[attributeKey];

    try {
      await updateBotAttributes(
        hubId!,
        { ...updatedAttributes },
      );
      onSuccess?.();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
      onError?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <div className={styles.personalizationFormWrapper}>
        {attributeType === 'chatbotName' && (
          <TextInput
            id="chatbot-name"
            inputProps={{ 'aria-label': intl.formatMessage(personalizationMessages.chatbotName) }}
            label={
              <FormattedMessage
                id="global.chatbotNameDescription"
                defaultMessage="Brand your chatbot with a name."
                description="Description for chatbot name field"
              />
            }
            placeholder={intl.formatMessage(messages.chatbotNamePlaceholder)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error}
            size="large"
            required
          />
        )}
        {attributeType === 'roleDescription' && (
          <TextArea
            id="role-description"
            aria-label={intl.formatMessage(personalizationMessages.roleDescription)}
            label={
              <FormattedMessage
                id="global.roleDescriptionDescriptionField"
                defaultMessage="Describe the best use of your chatbot for your audience."
                description="Description for role & description field"
              />
            }
            helpContent={
              <FormattedMessage
                id="global.roleDescriptionDescriptionHelp"
                defaultMessage="A good description will include the best uses and a brief description of the data sources this chatbot is trained with."
                description="Additional description for role & description field"
              />
            }
            placeholder={intl.formatMessage(messages.roleDescriptionPlaceholder)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error}
            size="large"
            required
            rows={5}
          />
        )}
        {attributeType === 'responseStyle' && <ResponseStyleField value={value} onChange={setValue} error={error} />}
        <PersonalizationFormFooter
          saveLabel={intl.formatMessage(hasSavedValue ? saveLabel : addLabel)}
          canSave={Boolean(value.trim()) && (!hasSavedValue || isDirty)}
          isSubmitting={isSubmitting}
          onSave={handleSubmit}
          secondaryAction={hasSavedValue ? 'discard' : 'cancel'}
          showSecondary={!hasSavedValue || isDirty}
          onSecondary={handleCancel}
          remove={canRemove ? {
            title: intl.formatMessage(personalizationFormMessages.removeTitle),
            titleContext: <><Icon id={getPersonalizationIcon(attributeKey)} aria-hidden /><FormattedMessage {...label} tagName="strong" /></>,
            body: (
            <>
              <FormattedMessage
                id="global.confirmDeletePersonalizationMessage"
                defaultMessage="Are you sure you want to <strong>remove</strong> this personalization attribute?"
                description="Message for confirmation dialog before removing a bot attribute"
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
              <FormattedMessage
                id="global.confirmDeletePersonalizationInfo"
                defaultMessage="This attribute will <strong>no longer</strong> be used in the chatbot’s responses."
                description="Info message for confirmation dialog before removing a bot attribute"
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
            </>
            ),
            confirmLabel: intl.formatMessage(personalizationFormMessages.removeConfirm),
            onConfirm: handleDelete,
          } : undefined}
        />
      </div>
  );
};

export default BotAttributeForm;
