import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import { isValidUrl, withScheme } from "@helpers/forms";

import TextInput from "@ui-components/input/TextInput";

import UserAgentAllowlistHint from "@components/UserAgentAllowlistHint";

import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import type { WordpressWizardStepProps } from "./WordpressWizard";

const messages = defineMessages({
  siteUrlPlaceholder: {
    id: "wordpressWizard.siteUrlPlaceholder",
    defaultMessage: "Example: https://www.your-site.com",
    description: "Placeholder text for the WordPress site URL input field",
  },
});

const WordpressWizardProvideUrl = ({
  isEditing,
  isSetup,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: WordpressWizardStepProps) => {
  const intl = useIntl();
  const [urlError, setUrlError] = useState<React.ReactNode>(null);

  const handleBlur = (value: string) => {
    const httpValue = withScheme(value);

    if (!isValidUrl(httpValue)) {
      setUrlError(
        <FormattedMessage
          id="global.invalidUrlError"
          defaultMessage="Invalid URL"
          description="Error message shown when user inputs an invalid url"
        />
      );
    } else {
      setUrlError(null);
      setWizardState({ ...wizardState, siteUrl: httpValue });
    }
  };

  return (
    <>
      {!isSetup &&
        <hgroup>
          <FormattedMessage
            id="global.locateArticlesToBeAdded"
            defaultMessage="Locate your articles to be added"
            description="Title for the Data Source configuration wizard step"
            tagName="h3"
          />
        </hgroup>
      }
      <div className={styles.wizardCardBody}>
        <FormattedMessage
          id="wordpressWizard.restApiHint"
          defaultMessage="We read your published posts or pages through the WordPress REST API, which is turned on by default on WordPress sites."
          description="Explains how posts are read from a WordPress site added as a data source"
          tagName="p"
        />
        <TextInput
          id="wordpress-site-url"
          error={urlError}
          helpContent={<UserAgentAllowlistHint />}
          label={
            <FormattedMessage
              id="wordpressWizard.siteUrlSetup"
              defaultMessage="Enter the address of your WordPress site"
              description="Label for the WordPress site URL input field during setup"
            />
          }
          placeholder={intl.formatMessage(messages.siteUrlPlaceholder)}
          required
          size="large"
          type="url"
          value={wizardState.siteUrl || ''}
          onChange={(e) => setWizardState({ ...wizardState, siteUrl: e.target.value, ownershipReceipt: undefined, applicationPasswordRevoked: undefined })}
          onBlur={(e) => handleBlur(e.target.value)}
        />
      </div>
      <WizardStepFooter
        disableNext={!wizardState.siteUrl || Boolean(urlError)}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoNext={() => onStepChange(currentStep + 1)}
      />
    </>
  );
};

export default WordpressWizardProvideUrl;
