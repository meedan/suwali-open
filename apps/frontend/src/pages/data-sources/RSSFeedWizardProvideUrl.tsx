import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import { normalizeUrl } from "@helpers/forms";

import { configureSource } from "@services/SourcesService";

import { HttpError } from "@root/NetworkLayer";
import { useSession } from "@root/SessionContext";

import UrlInput from "@ui-components/input/UrlInput";
import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import UserAgentAllowlistHint from "@components/UserAgentAllowlistHint";

import type { RSSFeedWizardStepProps } from "./RSSFeedWizard";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import WordpressDetectedHint from "./WordpressDetectedHint";

const messages = defineMessages({
  feedUrlPlaceholder: {
    id: "rssFeedWizard.feedUrlPlaceholder",
    defaultMessage: "Example:  https://www.your-site.com/articles/rss",
    description: "Placeholder text for the RSS Feed URL input field",
  },
});

const RSSFeedWizardProvideUrl = ({
  isEditing,
  isSetup,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
  onSwitchToWordpress,
}: RSSFeedWizardStepProps) => {
  const intl = useIntl();
  const { currentHubId } = useSession();
  const [configuring, setConfiguring] = useState(false);
  const [configureErrorType, setConfigureErrorType] = useState<'url_error' | 'rate_limit' | 'content_too_large' | null>(null);

  // What is sent is the address as tidied up, whether or not the field was left first
  const feedUrl = normalizeUrl(wizardState.feedUrl || '');

  const handleNext = async () => {
    if (!feedUrl) return;

    setConfiguring(true);
    setConfigureErrorType(null);
    try {
      const response = await configureSource({
        source: {
          hub_id: currentHubId(),
          source_type: 'rss_feed',
          config: { feed_url: feedUrl },
        },
      });
      if (response.error) throw new Error(response.error);
      const { type, selectors } = response.configuration ?? {};
      if (type === 'feed') {
        setWizardState({ ...wizardState, contentType: 'description_only', cssSelector: undefined });
      } else if (type === 'css') {
        setWizardState({ ...wizardState, contentType: 'full_article', cssSelector: selectors?.body ?? undefined });
      }
      onStepChange(currentStep + 1);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        setConfigureErrorType('rate_limit');
      } else if (error instanceof HttpError && error.status === 413) {
        setConfigureErrorType('content_too_large');
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
          id="rss-feed-url"
          disabled={configuring}
          helpContent={<UserAgentAllowlistHint />}
          label={
            isSetup ?
              <FormattedMessage
                id="global.feedUrlArticles"
                defaultMessage="Enter the URL for the RSS feed of your articles"
                description="Label for the RSS feed URL input field during setup"
              />
            :
              <FormattedMessage
                id="global.feedUrl"
                defaultMessage="Feed URL"
                description="Label for the RSS feed URL input field"
              />
          }
          placeholder={intl.formatMessage(messages.feedUrlPlaceholder)}
          required
          size="large"
          value={wizardState.feedUrl || ''}
          onChange={(value) => setWizardState({ ...wizardState, feedUrl: value })}
        />
      </div>
      {onSwitchToWordpress && !configuring && (
        <WordpressDetectedHint url={wizardState.feedUrl || ''} onSwitchToWordpress={onSwitchToWordpress} />
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
            configureErrorType === 'rate_limit' ? (
              <FormattedMessage
                id="dataSourceWizard.configureRateLimitError"
                defaultMessage="Too many requests. Please wait a few minutes and try your URL again."
                description="Error message shown when the configure request is rate limited"
              />
            ) : configureErrorType === 'content_too_large' ? (
              <FormattedMessage
                id="rssFeedWizard.configureContentTooLargeError"
                defaultMessage="This URL returns a file that’s too large to process. Please check the URL and try again."
                description="Error message shown when the RSS feed URL returns a response larger than the allowed limit during configuration"
              />
            ) : (
              <FormattedMessage
                id="rssFeedWizard.configureError"
                defaultMessage="Unable to reach this feed URL. Please check the URL and try again."
                description="Error message shown when the RSS feed URL cannot be reached during configuration"
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
              id="rssFeedWizard.checkingFeed"
              defaultMessage="Checking the feed…"
              description="Message shown next to a loading indicator while Suwali checks that an RSS feed URL can be reached"
            />
          }
        />
      )}
      <WizardStepFooter
        disableNext={!feedUrl || configuring}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoNext={handleNext}
      />
    </>
  );
};

export default RSSFeedWizardProvideUrl;
