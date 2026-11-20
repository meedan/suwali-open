import clsx from 'clsx';
import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { BotAttributes } from '@customTypes/hub';

import { fetchAbout } from '@services/AboutService';
import { updateBotAttributes } from '@services/HubService';

import Button from '@ui-components/input/Button';
import CheckboxCard from '@ui-components/layout/CheckboxCard';
import FieldHeading from '@ui-components/layout/FieldHeading';
import Icon from '@ui-components/layout/Icon';

import styles from './AvailableLanguagesForm.module.css';
import personalizationStyles from './Personalization.module.css';
import PersonalizationFormFooter from './PersonalizationFormFooter';
import { personalizationFormMessages } from './personalizationFormMessages';
import { personalizationMessages } from './personalizationSections';

const messages = defineMessages({
  setDefaultButton: {
    id: 'global.setDefaultButton',
    defaultMessage: 'Set default',
    description: 'Button label to set a language as default',
  },
  defaultLabel: {
    id: 'global.default',
    defaultMessage: 'Default',
    description: 'Label or title for a default status of an item or selection',
  },
});

type AvailableLanguagesFormProps = {
  hubId: number | string | null;
  currentBotAttributes?: BotAttributes;
  hasSavedValue?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
  onCancel?: () => void;
};

const ALL_LANGUAGES_VALUE = '__all__';

const AvailableLanguagesForm = ({
  hubId,
  currentBotAttributes = {},
  hasSavedValue = false,
  onSuccess,
  onError,
  onCancel,
}: AvailableLanguagesFormProps) => {
  const intl = useIntl();

  const { data: aboutData } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const languageOptions = aboutData?.languages || [];

  const existingSupportedLanguages = currentBotAttributes.supported_languages || [];
  const existingDefaultLanguage = currentBotAttributes.default_language || 'en';

  // Without a choice the chatbot responds in all languages, so there is then nothing to remove
  const canRemove = hasSavedValue && Boolean(currentBotAttributes.default_language || currentBotAttributes.supported_languages);

  const savedLanguages = hasSavedValue && existingSupportedLanguages.length > 0 ? existingSupportedLanguages : [ALL_LANGUAGES_VALUE];
  const savedDefaultLanguage = hasSavedValue ? existingDefaultLanguage : 'en';

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(savedLanguages);
  const [defaultLanguage, setDefaultLanguage] = useState(savedDefaultLanguage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAllLanguages = selectedLanguages.includes(ALL_LANGUAGES_VALUE);

  const handleLanguageChange = (code: string, checked: boolean) => {
    if (code === ALL_LANGUAGES_VALUE) {
      if (checked) {
        setSelectedLanguages([ALL_LANGUAGES_VALUE]);
      } else {
        setSelectedLanguages([defaultLanguage]);
      }
      return;
    }

    let updated: string[];
    if (checked) {
      updated = [...selectedLanguages.filter(l => l !== ALL_LANGUAGES_VALUE), code];
    } else {
      updated = selectedLanguages.filter(l => l !== code);
      // If removing the default language, reset default to first remaining or 'en'
      if (code === defaultLanguage && updated.length > 0) {
        setDefaultLanguage(updated[0]);
      }
    }
    setSelectedLanguages(updated);
  };

  const handleSetDefault = (code: string) => {
    setDefaultLanguage(code);
    // Ensure the language is selected
    if (!selectedLanguages.includes(code)) {
      setSelectedLanguages([...selectedLanguages, code]);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    const supportedLanguages = isAllLanguages ? [] : selectedLanguages;

    try {
      await updateBotAttributes(hubId!, {
        ...currentBotAttributes,
        default_language: defaultLanguage,
        supported_languages: supportedLanguages,
      });
      onSuccess?.();
    } catch {
      onError?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDirty = defaultLanguage !== savedDefaultLanguage
    || selectedLanguages.length !== savedLanguages.length
    || selectedLanguages.some(code => !savedLanguages.includes(code));

  // Editing existing languages, cancelling means going back to what was saved
  const handleCancel = () => {
    if (hasSavedValue) {
      setSelectedLanguages(savedLanguages);
      setDefaultLanguage(savedDefaultLanguage);
    } else {
      onCancel?.();
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);

    const updatedAttributes: BotAttributes = { ...currentBotAttributes };
    delete updatedAttributes.default_language;
    delete updatedAttributes.supported_languages;

    try {
      await updateBotAttributes(hubId!, updatedAttributes);
      onSuccess?.();
    } catch {
      onError?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLanguageSelected = (code: string) => isAllLanguages || selectedLanguages.includes(code);

  return (
      <div className={personalizationStyles.personalizationFormWrapper}>
        {/* The page heading says what the field is, so the visible heading is the instruction. The group is still named for the field */}
        <fieldset aria-label={intl.formatMessage(personalizationMessages.availableLanguages)} className={personalizationStyles.fieldGroup}>
          <FieldHeading
            label={
              <FormattedMessage
                id="global.selectLanguage"
                defaultMessage="Select the languages you would like your chatbot to respond in."
                description="Description for cta around available languages setting"
              />
            }
            description={
              <>
                <FormattedMessage
                  id="global.unsupportedLanguageDescription"
                  defaultMessage="If an end-user sends a message in an unsupported language, your chatbot will tell them so in that language."
                  description="Description for what happens when a user chats with the bot using an unsupported language"
                />
                {!canRemove && (
                  <>
                    {' '}
                    <FormattedMessage
                      id="global.availableLanguagesUnsetDescription"
                      defaultMessage="Until you choose, your chatbot responds in all languages."
                      description="Note on the available languages setting when none has been chosen yet, so the chatbot uses all languages"
                    />
                  </>
                )}
              </>
            }
          />
          <CheckboxCard
            className={styles.languageOption}
            id="language-all"
            title={
              <FormattedMessage
                id="global.allLanguages"
                defaultMessage="All languages"
                description="Label for all languages"
              />
            }
            selected={isAllLanguages}
            size="large"
            description={
              <FormattedMessage
                id="global.allLanguagesLabelExtra"
                defaultMessage="Including those added to the system in the future"
                description="Extra note about including future available languages"
              />
            }
            value={ALL_LANGUAGES_VALUE}
            onChange={() => handleLanguageChange(ALL_LANGUAGES_VALUE, !isAllLanguages)}
          />
          <div className={styles.languageRows}>
            {languageOptions.map((lang) => (
              <div key={lang.code} className={styles.languageRow}>
                <CheckboxCard
                  className={clsx(styles.languageOption, { [styles.languageOptionImplied]: isAllLanguages })}
                  disabled={isAllLanguages || lang.code === defaultLanguage}
                  id={`language-${lang.code}`}
                  title={lang.name}
                  selected={isLanguageSelected(lang.code)}
                  size="large"
                  value={lang.code}
                  onChange={() => handleLanguageChange(lang.code, !isLanguageSelected(lang.code))}
                />
                { isLanguageSelected(lang.code) &&
                  <Button
                    className={styles.languageDefault}
                    iconLeft={defaultLanguage === lang.code ? <Icon id="check" aria-hidden /> : null}
                    label={defaultLanguage === lang.code ? intl.formatMessage(messages.defaultLabel) : intl.formatMessage(messages.setDefaultButton)}
                    size="small"
                    themeMode={defaultLanguage !== lang.code}
                    onClick={() => defaultLanguage !== lang.code ? handleSetDefault(lang.code) : null}
                  />
                }
              </div>
            ))}
          </div>
        </fieldset>

        <PersonalizationFormFooter
          saveLabel={intl.formatMessage(hasSavedValue ? personalizationFormMessages.availableLanguagesSave : personalizationFormMessages.availableLanguagesAdd)}
          canSave={(isAllLanguages || selectedLanguages.length > 0) && (!hasSavedValue || isDirty)}
          isSubmitting={isSubmitting}
          onSave={handleSubmit}
          secondaryAction={hasSavedValue ? 'discard' : 'cancel'}
          showSecondary={!hasSavedValue || isDirty}
          onSecondary={handleCancel}
          remove={canRemove ? {
            title: intl.formatMessage(personalizationFormMessages.removeTitle),
            titleContext: (
              <>
                <Icon id="globe" aria-hidden />
                <FormattedMessage
                  id="global.availableLanguagesLabel"
                  defaultMessage="Available languages"
                  description="Label for available languages personalization setting"
                  tagName="strong"
                />
              </>
            ),
            body: (
            <>
              <FormattedMessage
                id="global.confirmDeleteLanguagesMessage"
                defaultMessage="Are you sure you want to <strong>remove</strong> the available languages personalization?"
                description="Message for confirmation dialog before removing languages setting"
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
              <FormattedMessage
                id="global.confirmDeleteLanguagesInfo"
                defaultMessage="The chatbot will <strong>respond in all languages</strong> with English as the default."
                description="Info message for confirmation dialog before removing languages setting"
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

export default AvailableLanguagesForm;
