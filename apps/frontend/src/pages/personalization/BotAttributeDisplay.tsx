import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { Tone } from '@customTypes/hub';

import { getPersonalizationIcon } from "@helpers/source";
import { toneDescriptions, toneLabels } from '@helpers/tone';

import { fetchAbout } from '@services/AboutService';

import Icon from '@ui-components/layout/Icon';
import ParsedText from '@ui-components/layout/ParsedText';

import styles from './Personalization.module.css';

const languagesMessages = defineMessages({
  defaultLanguageItem: {
    id: 'global.defaultLanguageItem',
    defaultMessage: '<strong>{language}</strong> (default)',
    description: 'A language in the list of languages the chatbot responds in, marked as the default one',
  },
});

type BotAttributeDisplayProps =
  | { type: 'name' | 'description' | 'tone'; value: string }
  // No languages means all of them
  | { type: 'languages'; languages: string[]; defaultLanguage?: string };

const BotAttributeDisplay = (props: BotAttributeDisplayProps) => {
  const { type } = props;
  const intl = useIntl();

  const { data: aboutData } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
    enabled: type === 'languages',
  });

  const languageName = (code: string) => aboutData?.languages?.find(language => language.code === code)?.name || code;

  const isTone = (toneValue: string): toneValue is Tone => toneValue in toneLabels;

  const renderContent = () => {
    if (props.type === 'languages') {
      // No languages saved means all of them, which are then the ones to list. English is the default until another is chosen.
      const isAll = props.languages.length === 0;
      const codes = isAll ? (aboutData?.languages ?? []).map(language => language.code) : props.languages;
      const defaultLanguage = props.defaultLanguage || 'en';

      return (
        <>
          {isAll ? (
            <FormattedMessage
              id="global.allAvailableLanguageRespond"
              defaultMessage="Your chatbot will respond in all available languages."
              description="Descriptive label or title to indicate that all available languages are listed"
              tagName="h3"
            />
          ) : (
            <FormattedMessage
              id="global.availableLanguageRespond"
              defaultMessage="Your chatbot will respond in the following languages:"
              description="Descriptive label or title to indicate the available languages"
              tagName="h3"
            />
          )}
          <ul className={styles.bulletList}>
            {codes.map(code => (
              <li key={code}>
                {code === defaultLanguage
                  ? <FormattedMessage {...languagesMessages.defaultLanguageItem} values={{ language: languageName(code), strong: msg => <strong key="strong">{msg}</strong> }} />
                  : <strong>{languageName(code)}</strong>
                }
              </li>
            ))}
          </ul>
        </>
      );
    }

    if (props.type === 'tone') {
      return (
        <>
          <h3>{isTone(props.value) ? intl.formatMessage(toneLabels[props.value]) : props.value}</h3>
          {isTone(props.value) && <FormattedMessage {...toneDescriptions[props.value]} tagName="p" />}
        </>
      );
    }

    return <h3><ParsedText text={props.value} /></h3>;
  };

  return (
    <div className={styles.personalizationCard}>
      <div className={clsx(styles.listPersonalizationItem, styles.listPersonalizationReadOnlyItem)}>
        <div className={styles.personalizationIconWrapper}>
          <Icon id={getPersonalizationIcon(type)} aria-hidden />
        </div>
        <div className={styles.listPersonalizationContentWrapper}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default BotAttributeDisplay;
