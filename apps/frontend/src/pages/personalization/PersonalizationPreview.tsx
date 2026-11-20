import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { Scenario } from '@customTypes/external-resource';

import { fetchAbout } from '@services/AboutService';
import { fetchPreview } from '@services/HubService';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import Icon from '@ui-components/layout/Icon';
import { PollingLoading } from '@ui-components/layout/LoadingIndicator';
import MessageBubble from '@ui-components/layout/MessageBubble';
import ParsedText from "@ui-components/layout/ParsedText";

import { isRTL } from '@components/LanguageProvider';

import styles from './Personalization.module.css';
import { scenarioLabels, scenarios } from './scenarioLabels';

const messages = defineMessages({
  generateButton: {
    id: 'global.generateAnotherExample',
    defaultMessage: 'Generate another example',
    description: 'Button label to generate another preview example',
  },
});

type PersonalizationPreviewProps = {
  hubId: number;
  defaultLanguage?: string;
  hubLanguages?: string[];
};

const PersonalizationPreview = ({ hubId, defaultLanguage, hubLanguages }: PersonalizationPreviewProps) => {
  const intl = useIntl();
  const [scenario, setScenario] = useState<Scenario | ''>('');
  const [language, setLanguage] = useState('');

  const { data: aboutData } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const supportedLanguages = aboutData?.languages || [];
  const currentLanguageCode = defaultLanguage || 'en';
  const selectedLanguage = language || currentLanguageCode;
  // No hub languages configured means the chatbot replies in any of them
  const languageOptions = hubLanguages?.length
    ? supportedLanguages.filter(l => l.code === currentLanguageCode || hubLanguages.includes(l.code))
    : supportedLanguages;

  const previewMutation = useMutation({
    mutationFn: ({ scenario: selectedScenario, language: previewLanguage }: { scenario: Scenario; language: string }) =>
      fetchPreview({ hubId, scenario: selectedScenario, language: previewLanguage }),
  });

  const handleSelect = (value: string) => {
    setScenario(value as Scenario);
    previewMutation.mutate({ scenario: value as Scenario, language: selectedLanguage });
  };

  const handleLanguageSelect = (value: string) => {
    setLanguage(value);
    if (scenario) previewMutation.mutate({ scenario, language: value });
  };

  const handleGeneratePreview = () => {
    if (scenario) previewMutation.mutate({ scenario, language: selectedLanguage });
  };

  return (
    <div className={styles.previewContainer}>
      <FormattedMessage
        id="global.previewPersonalizations"
        defaultMessage="Preview personalizations"
        description="Title for preview personalizations"
        tagName="h2"
      />
      <FormattedMessage
        id="global.previewPersonalizationsDescription"
        defaultMessage="Select a scenario below to see an example message of how your chatbot would reply using your defined attributes & resources."
        description="Description about preview personalizations"
        tagName="p"
      />
      {languageOptions.length > 1 && (
        <Select
          label={
            <FormattedMessage
              id="global.replyLanguage"
              defaultMessage="Reply language"
              description="Reusable label that refers to the language a chatbot reply is written in"
            />
          }
          value={selectedLanguage}
          onValueChange={handleLanguageSelect}
          size="large"
        >
          <>
            {languageOptions.map(({ code, name }) => (
              <SelectItem key={code} value={code}>{name}</SelectItem>
            ))}
          </>
        </Select>
      )}
      <Select
        label={
          <FormattedMessage
            id="global.scenario"
            defaultMessage="Scenario"
            description="Label for detected scenario"
          />
        }
        helpContent={
          <FormattedMessage
            id="global.previewPersonalizationsDisclaimer"
            defaultMessage="Your chatbot may not respond exactly the same way each time."
            description="Disclaimer about preview personalizations"
          />
        }
        value={scenario}
        onValueChange={handleSelect}
        size="large"
        placeholder={
          <FormattedMessage
            id="global.previewPersonalizationsSelectScenario"
            defaultMessage="Select a scenario…"
            description="Description about selecting a scenario to preview personalizations"
          />
        }
      >
        <>
          {scenarios.map((option) => (
            <SelectItem key={option} value={option}>
              <FormattedMessage {...scenarioLabels[option]} />
            </SelectItem>
          ))}
        </>
      </Select>

      {previewMutation.isPending && (
        <MessageBubble size="medium" fullWidth className={styles.previewBubble}>
          <div className={styles.polling}>
            <PollingLoading size="medium" className={styles.pollingLoading} />
          </div>
        </MessageBubble>
      )}

      {previewMutation.data && !previewMutation.isPending && (
        <div dir={isRTL(previewMutation.variables?.language ?? '') ? 'rtl' : 'ltr'}>
          <MessageBubble size="medium" fullWidth className={styles.previewBubble}>
            <ParsedText text={previewMutation.data} />
          </MessageBubble>
        </div>
      )}

      {previewMutation.isError && (
        <div className={styles.previewMessage}>
          <p role="alert">
            <FormattedMessage
              id="global.previewPersonalizationsError"
              defaultMessage="It was not possible to generate an example message. Please try again."
              description="Shown in the personalization preview panel when the example chatbot message could not be generated"
            />
          </p>
        </div>
      )}

      {scenario && (
        <Button
          label={intl.formatMessage(messages.generateButton)}
          iconLeft={<Icon id="arrow_clockwise" />}
          onClick={handleGeneratePreview}
          disabled={previewMutation.isPending}
          className={styles.generateButton}
          variant="filled"
          size="small"
          themeMode
        />
      )}
    </div>
  );
};

export default PersonalizationPreview;
