import { useState } from "react";
import { FormattedMessage } from "react-intl";

import { createSource, previewSource, updateSource } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import type { WordpressWizardStepProps } from "./WordpressWizard";

interface SourceItem {
  external_id: string;
  title: string;
  content: string;
  link: string;
}

const WordpressWizardTestAndCreate = ({
  source,
  isEditing,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
  wizardState,
  readOnly,
}: WordpressWizardStepProps) => {
  const [sourcePreview, setSourcePreview] = useState<SourceItem[]>([]);
  const [sourcePreviewTotal, setSourcePreviewTotal] = useState<number | null>(null);
  const [previewSuccess, setPreviewSuccess] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const hubId = useSession().currentHubId();

  const goBack = (currentStep > 0) ? () => onStepChange(currentStep - 1) : undefined;

  // The API returns the site URL normalized (e.g. without a trailing /wp-json/)
  const siteUrl = suggestedUrl || wizardState.siteUrl;

  const buildPayload = () => {
    return {
      source: {
        ...(wizardState.ownershipReceipt && { ownership_receipt: wizardState.ownershipReceipt }),
        hub_id: hubId,
        name: isEditing ? source!.name : (suggestedName || siteUrl),
        source_type: "wordpress_api",
        active: source ? source.active : true,
        config: {
          site_url: siteUrl,
          content_type: wizardState.contentType || "posts",
        },
      },
    };
  };

  const handlePreview = () => {
    const payload = buildPayload();
    setLoadingPreview(true);
    setSourcePreview([]);
    setSourcePreviewTotal(null);
    setPreviewError(null);

    previewSource(payload).then((response) => {
      if (response.error) {
        throw new Error(response.error);
      }
      const data = response.documents;
      if (!Array.isArray(data)) {
        throw new Error("Invalid preview data format");
      }
      setSourcePreview(data.slice(0, 3));
      setSourcePreviewTotal(response.total);
      setSuggestedName(response.suggested_name);
      setSuggestedUrl(response.suggested_url ?? null);
      setPreviewSuccess(true);
    }).catch((error) => {
      setPreviewError(error?.message || String(error) || "Error");
      setPreviewSuccess(false);
      console.error("Error previewing Data Source:", error);
    }).finally(() => {
      setLoadingPreview(false);
    });
  };

  const handleSaved = (data: { id?: number }) => {
    if (data.id) {
      onCreate(data.id);
    }
  };

  const handleCreateSource = () => {
    setIsSaving(true);
    createSource(buildPayload()).then(handleSaved).catch((error) => {
      console.error("Error creating Data Source:", error);
    }).finally(() => {
      setIsSaving(false);
    });
  };

  const handleUpdateSource = (sourceId: number) => {
    setIsSaving(true);
    updateSource(sourceId, buildPayload()).then(handleSaved).catch((error) => {
      console.error("Error updating Data Source:", error);
    }).finally(() => {
      setIsSaving(false);
    });
  };

  const testButton = (
    <Button
      className="testConfiguration"
      variant="filled"
      label={
        <FormattedMessage
          id="global.testConfiguration"
          defaultMessage="Test configuration"
          description="Button label for testing configuration before creating the data source"
        />
      }
      size="small"
      onClick={handlePreview}
      disabled={!wizardState.siteUrl}
    />
  );

  return (
    <>
      <hgroup>
        <FormattedMessage
          id="global.reviewAndTestCardTitle"
          defaultMessage="Review and test configuration"
          description="Title for the Data Source configuration wizard"
          tagName="h3"
        />
      </hgroup>
      <div className={styles.wizardCardBody}>
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="wordpressWizard.siteUrl"
            defaultMessage="Site URL"
            description="Label for the WordPress site URL input field"
            tagName="strong"
          />
          <div className={styles.row}>
            <a target="_blank" href={siteUrl} title={siteUrl} rel="noopener noreferrer">
              {siteUrl}
            </a>
          </div>
        </div>
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="wordpressWizard.contentType"
            defaultMessage="Content type"
            description="Label for the Wordpress content type selection input field"
            tagName="strong"
          />
          <div className={styles.row}>
            {wizardState.contentType === "posts" && (
              <FormattedMessage
                id="wordpressWizard.posts"
                defaultMessage="Posts"
                description="Refers to the Wordpress content type Post"
              />
            )}
            {wizardState.contentType === "pages" && (
              <FormattedMessage
                id="wordpressWizard.pages"
                defaultMessage="Pages"
                description="Refers to the Wordpress content type Page"
              />
            )}
          </div>
        </div>
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="global.fullArticleContentLabel"
            defaultMessage="Article content"
            description="Label for the RSS Feed full article CSS selector input field"
            tagName="strong"
          />
          <div className={styles.row}>
            <FormattedMessage
              id="wordpressWizard.articleContent"
              defaultMessage="Use the title and full text of each published article from this content type"
              description="Explains which content is imported from each article of a WordPress site"
            />
          </div>
        </div>
        {!previewError && !sourcePreview.length && (
          <HintBox
            type="info"
            title={
              <FormattedMessage
                id="global.testYourConfiguration"
                defaultMessage="Test your data source configuration"
                description="Help content for the Data Source preview section"
              />
            }
            body={
              <FormattedMessage
                id="global.sourcePreviewHelp"
                defaultMessage="We will pull 2-3 sample articles to verify your configuration is working correctly."
                description="Help content for the Data Source preview section"
              />
            }
            actions={testButton}
          />
        )}
        {!previewError && (sourcePreview.length > 0) && (
          <HintBox
            type="success"
            title={
              <FormattedMessage
                id="global.testSuccessful"
                defaultMessage="Test successful!"
                description="Generic message indicating a successful test"
              />
            }
            body={
              <FormattedMessage
                id="global.sampleArticlesFetched"
                defaultMessage="{total, plural, =0 {No supported articles found} one {Found 1 supported article. Here it is:} other {Found # supported articles. Here are {number} sample articles:}}"
                description="Message indicating number of sample articles fetched and total number of articles available"
                values={{ total: sourcePreviewTotal, number: sourcePreview.length }}
              />
            }
          />
        )}
        {previewError && (
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
              <FormattedMessage
                id="global.unableToRetrieveArticles"
                defaultMessage="Unable to retrieve articles. There may be something wrong with your configuration. Please verify your settings and retry. Reach out to our support if you need help. The error is: {error}"
                description="Message displayed when unable to retrieve articles from a data source"
                values={{ error: <strong key="error">{previewError}</strong> }}
              />
            }
            actions={testButton}
          />
        )}
        {loadingPreview && (
          <PollingLoading
            size="medium"
            message={
              <FormattedMessage
                id="wordpressWizard.retrievingArticles"
                defaultMessage="Retrieving articles from your site…"
                description="Message shown next to a loading indicator while Suwali fetches a preview of articles from the WordPress site"
              />
            }
          />
        )}
        {sourcePreview.length > 0 && (
          <div className={styles.wizardSourcePreviewArea}>
            <ul>
              {sourcePreview.map(f => (
                <li key={f.external_id} id={`source-preview-entry-${f.external_id}`}>
                  <div className={styles.wizardsourcePreviewItem}>
                    <strong>{f.title}</strong>
                    {f.content && <div className={styles.content}>{f.content}</div>}
                    {f.link && (
                      <a target="_blank" href={f.link} title={f.link} rel="noopener noreferrer">
                        {f.link}
                      </a>
                    )}
                  </div>
                </li>)
              )}
            </ul>
          </div>
        )}
        {previewSuccess && !sourcePreview.length && (
          <HintBox
            type="warning"
            title={
              <FormattedMessage
                id="global.potentialProblem"
                defaultMessage="There may be a problem with your data source"
                description="Label displayed when an error may have occurred, but needs more details"
              />
            }
            body={
              <FormattedMessage
                id="global.dataSourceConnectedNoData"
                defaultMessage="We successfully connected to the data source but no documents were found. You can still connect this data source and we will pull the documents as they are added or published to it."
                description="Helper text when no documents are found at the source"
              />
            }
          />
        )}
      </div>
      {!readOnly && (
        <WizardStepFooter
          onCancel={onCancel}
          onGoBack={goBack}
          onComplete={() => {
            if (isEditing && source?.id) {
              handleUpdateSource(source.id);
            } else {
              handleCreateSource();
            }
          }}
          isEditing={isEditing}
          disableComplete={!previewSuccess || isSaving}
        />
      )}
    </>
  );
};

export default WordpressWizardTestAndCreate;
