import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import Icon from "@ui-components/layout/Icon";

import type { WizardProps } from "./DataSourcesCreateWizard";
import WebsiteWizardArticleContent from "./WebsiteWizardArticleContent";
import WebsiteWizardProvideUrl from "./WebsiteWizardProvideUrl";
import WebsiteWizardTestAndCreate from "./WebsiteWizardTestAndCreate";
import styles from "./Wizard.module.css";

const getWizardHeading = () => ({
  icon: 'website_source',
  label: (
    <FormattedMessage
      id="global.connectBlogWebsite"
      defaultMessage="Sync with a blog or website of articles"
      description="Label for the connecting a google drive folder as a data source type"
    />
  ),
});

const getWizardSteps = () => {
  const wizardSteps = [
    {
      label: (
        <FormattedMessage
          id="global.articlesList"
          defaultMessage="Articles list"
          description="Label for the article list configuration step"
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
          id="websiteWizard.linksAndContent"
          defaultMessage="Links & content"
          description="Label for the article content selection step"
        />
      ),
      description: (
        <FormattedMessage
          id="websiteWizard.linksAndContentDescription"
          defaultMessage="Selectors to identify your content"
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

export type WebsiteWizardState = {
  multiPage: boolean;
  websiteUrl: string;
  paginationSampleUrl?: string;
  templateUrl?: string;
  paginationStart?: number;
  paginationEnd?: number;
  linksCssSelector?: string;
  titleCssSelector?: string;
  bodyCssSelector?: string;
  platform?: string;
};

export type WebsiteWizardStepProps = WizardProps & {
  wizardState: WebsiteWizardState;
  setWizardState: React.Dispatch<React.SetStateAction<WebsiteWizardState>>;
  readOnly?: boolean;
};

const WebsiteWizard = ({
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
    pagination_start?: number;
    pagination_end?: number;
    base_url?: string;
    post_link_selector?: string;
    title_selector?: string;
    body_selector?: string;
  } || {};

  const defaultState = {
    multiPage: true,
    paginationStart: safeConfig.pagination_start || 1,
    paginationEnd: safeConfig.pagination_end || 100,
    websiteUrl: safeConfig.base_url || '',
    linksCssSelector: safeConfig.post_link_selector || '',
    titleCssSelector: safeConfig.title_selector || '',
    bodyCssSelector: safeConfig.body_selector || '',
  } as WebsiteWizardState;

  const [wizardState, setWizardState] = useState<WebsiteWizardState>(defaultState);

  const handleCancel = () => {
    onStepChange(0);
    onCancel();
    setWizardState(defaultState);
  };

  const wizardStepProps = {
    source,
    isEditing,
    isSetup,
    readOnly,
    onCancel: handleCancel,
    onCreate,
    onStepChange,
    currentStep,
    wizardState,
    setWizardState,
    onSwitchToWordpress,
  } as WebsiteWizardStepProps;

  const stepComponents = [
    <WebsiteWizardProvideUrl {...wizardStepProps} />,
    <WebsiteWizardArticleContent {...wizardStepProps} />,
    <WebsiteWizardTestAndCreate {...wizardStepProps} />,
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

WebsiteWizard.getWizardSteps = getWizardSteps;
WebsiteWizard.getWizardHeading = getWizardHeading;

export default WebsiteWizard;
