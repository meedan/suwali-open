import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import Icon from "@ui-components/layout/Icon";

import type { WizardProps } from "./DataSourcesCreateWizard";
import styles from "./Wizard.module.css";
import WordpressWizardProvideUrl from "./WordpressWizardProvideUrl";
import WordpressWizardSelectContentType from "./WordpressWizardSelectContentType";
import WordpressWizardTestAndCreate from "./WordpressWizardTestAndCreate";
import WordpressWizardVerifyOwnership from "./WordpressWizardVerifyOwnership";

export type WordpressWizardState = {
  siteUrl?: string;
  contentType?: "posts" | "pages";
  // Proof from the API that the user administers siteUrl; cleared whenever siteUrl changes
  ownershipReceipt?: string;
  // Set when ownership was verified with an Application Password: whether Suwali revoked it afterwards
  applicationPasswordRevoked?: boolean;
};

const getWizardHeading = () => ({
  icon: 'wordpress_source',
  label: (
    <FormattedMessage
      id="wordpressWizard.connectWordpress"
      defaultMessage="Connect a WordPress site"
      description="Title for the setup step that connects a WordPress site as a data source"
    />
  ),
});

const getWizardSteps = () => {
  const wizardSteps = [
    {
      label: (
        <FormattedMessage
          id="wordpressWizard.siteUrl"
          defaultMessage="Site URL"
          description="Label for the WordPress site URL input field"
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
          id="wordpressWizard.verifyOwnershipStep"
          defaultMessage="Verify ownership"
          description="Label for the WordPress wizard step where the user proves they administer the site"
        />
      ),
      description: (
        <FormattedMessage
          id="wordpressWizard.verifyOwnershipStepDescription"
          defaultMessage="Confirm you manage the site"
          description="Description for the WordPress wizard step where the user proves they administer the site"
        />
      ),
    },
    {
      label: (
        <FormattedMessage
          id="wordpressWizard.selectContentType"
          defaultMessage="Select content type"
          description="Title for the content type selection step in the WordPress wizard"
        />
      ),
      description: (
        <FormattedMessage
          id="wordpressWizard.selectContentTypeDescription"
          defaultMessage="Select the type of content you want to import"
          description="Description for the WordPress content type selection step"
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

export type WordpressWizardStepProps = WizardProps & {
  wizardState: WordpressWizardState;
  setWizardState: (state: WordpressWizardState) => void;
  readOnly?: boolean;
};

const WordpressWizard = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
  initialSiteUrl,
}: WizardProps & { initialSiteUrl?: string }) => {
  const { config } = source || {};
  const safeConfig = config as { site_url?: string, content_type?: "posts" | "pages" } || {};

  const defaultState: WordpressWizardState = {
    siteUrl: safeConfig?.site_url || initialSiteUrl || '',
    contentType: safeConfig?.content_type || "posts",
  };

  const [wizardState, setWizardState] = useState<WordpressWizardState>(defaultState);

  const handleCancel = () => {
    onStepChange(0);
    onCancel();
    setWizardState(defaultState);
  };

  const wizardStepProps: WordpressWizardStepProps = {
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
  };

  const stepComponents = [
    <WordpressWizardProvideUrl {...wizardStepProps} />,
    <WordpressWizardVerifyOwnership {...wizardStepProps} />,
    <WordpressWizardSelectContentType {...wizardStepProps} />,
    <WordpressWizardTestAndCreate {...wizardStepProps} />,
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

WordpressWizard.getWizardSteps = getWizardSteps;
WordpressWizard.getWizardHeading = getWizardHeading;

export default WordpressWizard;
