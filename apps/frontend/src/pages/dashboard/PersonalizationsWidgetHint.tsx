import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";

import type { ExternalResource } from "@customTypes/external-resource";
import type { Tone } from "@customTypes/hub";

import { DEFAULT_TONE, toneLabels } from "@helpers/tone";

import { useHubPath } from "@hooks/useHubPath";

import HintBox from "@ui-components/layout/HintBox";

import styles from "./PersonalizationsWidget.module.css";

interface PersonalizationsWidgetHintProps {
  tone?: string;
  languages?: string[];
  resources?: ExternalResource[];
}

const PersonalizationsWidgetHint = ({
  tone,
  languages,
  resources,
}: PersonalizationsWidgetHintProps) => {
  const intl = useIntl();
  const hubPath = useHubPath();

  const hasLanguages = !!languages?.length;
  const hasResources = !!resources?.length;

  // Until a tone or languages are chosen the chatbot uses the default tone and all languages, so say so once anything is set.
  // With nothing set the hint points to external resources instead.
  const hasAnything = !!tone || hasLanguages || hasResources;
  const effectiveTone = tone || DEFAULT_TONE;

  const scenarioCount = resources?.reduce((count, resource) => count + (resource.scenarios?.length || 0), 0) || 0;

  const toneMessage = toneLabels[effectiveTone as Tone];
  const toneLocalized = toneMessage ? intl.formatMessage(toneMessage) : effectiveTone;

  const toneString = (
    <FormattedMessage
      id="personalizationsWidgetHint.tone"
      defaultMessage="<link>{tone} tone</link>"
      description="The tone of the chatbot. E.g.: Advocate tone, Journalist tone, etc."
      values={{ tone: toneLocalized, link: msg => <Link key="tone" to={hubPath('/personalization/tone')}>{msg}</Link> }}
    />
  );

  const languagesLink = (msg: React.ReactNode) => <Link key="languages" to={hubPath('/personalization/languages')}>{msg}</Link>;

  // Only used when languages are chosen. Without any the sentences say all languages themselves, so the wording around it can follow
  const languagesString = (
    <FormattedMessage
      id="personalizationsWidgetHint.languages"
      defaultMessage="<link>{count, plural, one {# language} other {# languages}}</link>"
      description="The languages the chatbot will respond in."
      values={{ count: languages?.length, link: languagesLink }}
    />
  );

  // Whether languages were chosen, or none were and the chatbot responds in all of them
  const languageMode = hasLanguages ? 'chosen' : 'all';

  const resourcesString = (
    <FormattedMessage
      id="personalizationsWidgetHint.resources"
      defaultMessage="<link>{count, plural, one {# resource} other {# resources}}</link>"
      description="The resources the chatbot will use."
      values={{ count: resources?.length, link: msg => <Link key="resources" to={hubPath('/personalization/resources')}>{msg}</Link> }}
    />
  );

  const scenariosString = (
    <FormattedMessage
      id="personalizationsWidgetHint.scenarios"
      defaultMessage="<link>{count, plural, one {# scenario} other {# scenarios}}</link>"
      description="The scenarios the chatbot will use."
      values={{ count: scenarioCount, link: msg => <Link key="scenarios" to={hubPath('/personalization/resources')}>{msg}</Link> }}
    />
  );

  const message = !hasAnything ? null : hasResources ? (
    <FormattedMessage
      id="personalizationsWidgetHint.toneLanguagesResources"
      defaultMessage="{languageMode, select, all {The {tone} of your chatbot will respond in <languagesLink>all languages</languagesLink> using {resources} covering {scenarios}.} other {The {tone} of your chatbot will respond in {languages} using {resources} covering {scenarios}.}}"
      description="Hint about personalizations. When no languages have been chosen the chatbot responds in all of them"
      tagName="span"
      values={{
        languageMode,
        languagesLink,
        tone: toneString,
        languages: languagesString,
        resources: resourcesString,
        scenarios: scenariosString,
      }}
    />
  ) : (
    <FormattedMessage
      id="personalizationsWidgetHint.toneLanguages"
      defaultMessage="{languageMode, select, all {The {tone} of your chatbot will respond in <languagesLink>all languages</languagesLink>.} other {The {tone} of your chatbot will respond in {languages}.}}"
      description="Hint about personalizations. When no languages have been chosen the chatbot responds in all of them"
      tagName="span"
      values={{
        languageMode,
        languagesLink,
        tone: toneString,
        languages: languagesString,
      }}
    />
  );

  return message ? (
    <HintBox
      className={styles.hintBox}
      iconId="bot_voice"
      type="themeMode"
      body={message}
    />
  ) : (
    <HintBox
      type="info"
      body={
        <FormattedMessage
          id="personalizationsWidget.resourcesHint"
          defaultMessage="Point your chatbot to resources that you want to use in responding to your audience."
          description="Hint about external resources"
        />
      }
    />
  );
};

export default PersonalizationsWidgetHint;
