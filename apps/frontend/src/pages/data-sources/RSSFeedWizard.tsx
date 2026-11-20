import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import Icon from "@ui-components/layout/Icon";

import type { WizardProps } from "./DataSourcesCreateWizard";
import RSSFeedWizardArticleContent from "./RSSFeedWizardArticleContent";
import RSSFeedWizardProvideUrl from "./RSSFeedWizardProvideUrl";
import RSSFeedWizardTestAndCreate from "./RSSFeedWizardTestAndCreate";
import styles from "./Wizard.module.css";

export type RSSFeedWizardState = {
  feedUrl?: string;
  contentType?: 'full_article' | 'description_only';
  cssSelector?: string;
};

const getWizardHeading = () => ({
  icon: 'rss_source',
  label: (
    <FormattedMessage
      id="global.connectRss"
      defaultMessage="Connect an RSS feed"
      description="Label for the connecting an rss feed as a data source type"
    />
  ),
});

const getWizardSteps = () => {
  const wizardSteps = [
    {
      label: (
        <FormattedMessage
          id="global.feedUrl"
          defaultMessage="Feed URL"
          description="Label for the RSS feed URL input field"
        />
      ),
      description: (
        <FormattedMessage
          id="global.locateYourArticles"
          defaultMessage="Locate your articles"
          description="Description for the Data Source configuration wizard step"
        />
      ),
    },
    {
      label: (
        <FormattedMessage
          id="global.articleContent"
          defaultMessage="Article content"
          description="Label for an article content"
        />
      ),
      description: (
        <FormattedMessage
          id="global.selectMainArticleContent"
          defaultMessage="Select main article content"
          description="Description for the article content selection step"
        />
      ),
    },
    {
      label: (
        <FormattedMessage
          id="global.reviewAndTest"
          defaultMessage="Review & test"
          description="Label for the review and testing configuration step"
        />
      ),
      description: (
        <FormattedMessage
          id="global.verifyConfiguration"
          defaultMessage="Verify configuration"
          description="Label for the review and testing configuration step"
        />
      ),
    },
  ];

  return wizardSteps;
};

export type RSSFeedWizardStepProps = WizardProps & {
  wizardState: RSSFeedWizardState;
  setWizardState: (state: RSSFeedWizardState) => void;
  readOnly?: boolean;
};

const RSSFeedWizard = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
  onSwitchToWordpress,
}: WizardProps) => {
  const { config } = source || {};
  // Type assertion to treat config as the expected object shape
  const safeConfig = config as {
    feed_url?: string;
    expanded_description_selector?: string;
  } || {};

  const defaultState = {
    feedUrl: safeConfig?.feed_url || '',
    cssSelector: safeConfig?.expanded_description_selector || '',
    contentType: safeConfig?.expanded_description_selector ? 'full_article' : 'description_only',
  } as RSSFeedWizardState;

  const [wizardState, setWizardState] = useState<RSSFeedWizardState>(defaultState);

  const handleCancel = () => {
    onStepChange(0);
    onCancel();
    setWizardState(defaultState);
  };

  const wizardStepProps = {
    source,
    isEditing,
    isSetup,
    onCancel: handleCancel,
    onCreate,
    onStepChange,
    currentStep,
    wizardState,
    setWizardState,
    readOnly,
    onSwitchToWordpress,
  } as RSSFeedWizardStepProps;

  const stepComponents = [
    <RSSFeedWizardProvideUrl {...wizardStepProps} />,
    <RSSFeedWizardArticleContent {...wizardStepProps} />,
    <RSSFeedWizardTestAndCreate {...wizardStepProps} />,
  ];

  const heading = getWizardHeading();

  return (
    <div className={clsx(styles.wizardCard, { [styles.wizardSetupCard]: isSetup })}>
      {isSetup &&
        <div className={styles.dataSourceCreateWizareSetupTitle}>
          <Icon id={heading.icon} aria-hidden />
          <h6>{heading.label}</h6>
        </div>
      }
      {stepComponents[currentStep]}
    </div>
  );
};

RSSFeedWizard.getWizardSteps = getWizardSteps;
RSSFeedWizard.getWizardHeading = getWizardHeading;

export default RSSFeedWizard;
