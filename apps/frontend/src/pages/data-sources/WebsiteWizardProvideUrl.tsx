import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { normalizeUrl } from "@helpers/forms";

import { configureSource } from "@services/SourcesService";

import { HttpError } from "@root/NetworkLayer";
import { useSession } from "@root/SessionContext";

import UrlInput from "@ui-components/input/UrlInput";
import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import UserAgentAllowlistHint from "@components/UserAgentAllowlistHint";

import type { WebsiteWizardStepProps } from "./WebsiteWizard";
import { messages, templateToSampleUrl } from "./WebsiteWizardPaginationCardUtil";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import WordpressDetectedHint from "./WordpressDetectedHint";

const WebsiteWizardProvideUrl = ({
  isEditing,
  isSetup,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
  onSwitchToWordpress,
}: WebsiteWizardStepProps) => {
  const intl = useIntl();
  const { currentHubId } = useSession();
  const [configuring, setConfiguring] = useState(false);
  const [configureErrorType, setConfigureErrorType] = useState<'url_error' | 'rate_limit' | null>(null);


  // What is sent is the address as tidied up, whether or not the field was left first
  const websiteUrl = normalizeUrl(wizardState.websiteUrl);

  const handleNext = async () => {
    if (!websiteUrl) return;

    setConfiguring(true);
    setConfigureErrorType(null);
    try {
      const response = await configureSource({
        source: {
          hub_id: currentHubId(),
          source_type: 'website',
          config: { base_url: websiteUrl },
        },
      });
      if (response.error) throw new Error(response.error);
      const { type, selectors, pagination } = response.configuration ?? {};
      setWizardState({
        ...wizardState,
        platform: type ?? undefined,
        linksCssSelector: selectors?.link ?? undefined,
        titleCssSelector: selectors?.title ?? undefined,
        bodyCssSelector: selectors?.body ?? undefined,
        multiPage: pagination?.multi_page ?? wizardState.multiPage,
        templateUrl: pagination?.suggested_website_url ?? undefined,
        paginationSampleUrl: pagination?.suggested_website_url ? templateToSampleUrl(pagination.suggested_website_url) : undefined,
      });
      onStepChange(currentStep + 1);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        setConfigureErrorType('rate_limit');
      } else {
        setConfigureErrorType('url_error');
      }
    } finally {
      setConfiguring(false);
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
        <UrlInput
          id="website-url"
          disabled={configuring}
          helpContent={<UserAgentAllowlistHint />}
          label={
            isSetup ?
              <FormattedMessage
                id="global.articleListUrl"
                defaultMessage="Enter the URL for your blog or website’s list of articles"
                description="Label for the website article list URL input field during setup"
              />
            :
            <FormattedMessage
              id="global.articleListUrlLabel"
              defaultMessage="Article list URL"
              description="Label for the article list URL input field"
            />
          }
          placeholder={intl.formatMessage(messages.websiteUrlPlaceholder)}
          required
          size="large"
          value={wizardState.websiteUrl}
          onChange={(value) => setWizardState({ ...wizardState, websiteUrl: value })}
        />
      </div>
      {onSwitchToWordpress && !configuring && (
        <WordpressDetectedHint url={wizardState.websiteUrl} onSwitchToWordpress={onSwitchToWordpress} />
      )}
      {configureErrorType && (
        <HintBox
          type="error"
          title={
            <FormattedMessage
              id="global.thatDidntWorkAsExpected"
              defaultMessage="That didn’t work as expected"
              description="Label displayed when an error occurs in the app"
            />
          }
          body={
            configureErrorType === "rate_limit" ? (
              <FormattedMessage
                id="dataSourceWizard.configureRateLimitError"
                defaultMessage="Too many requests. Please wait a few minutes and try your URL again."
                description="Error message shown when the configure request is rate limited"
              />
            ) : (
              <FormattedMessage
                id="websiteWizard.configureError"
                defaultMessage="Unable to reach this URL. Please check the URL and try again."
                description="Error message shown when the website URL cannot be reached during configuration"
              />
            )
          }
        />
      )}
      {configuring && (
        <PollingLoading
          size="medium"
          message={
            <FormattedMessage
              id="websiteWizard.checkingWebsite"
              defaultMessage="Checking the website…"
              description="Message shown next to a loading indicator while Suwali checks that a website URL can be reached"
            />
          }
        />
      )}
      <WizardStepFooter
        disableNext={!websiteUrl || configuring}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoNext={handleNext}
      />
    </>
  );
};

export default WebsiteWizardProvideUrl;
