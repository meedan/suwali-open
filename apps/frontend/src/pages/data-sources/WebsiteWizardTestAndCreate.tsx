import { useState } from "react";
import { FormattedMessage } from "react-intl";

import { createSource, previewSource, updateSource } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import type { WebsiteWizardStepProps } from "./WebsiteWizard";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";

interface SourceItem {
  external_id: string;
  title: string;
  content: string;
  link: string;
  metadata: {
    description?: string;
    url?: string;
  }
}

const WebsiteWizard = ({
  source,
  isEditing,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
  wizardState,
  readOnly,
}: WebsiteWizardStepProps) => {
  const [sourcePreview, setSourcePreview] = useState<SourceItem[]>([]);
  const [sourcePreviewTotal, setSourcePreviewTotal] = useState<number | null>(null);
  const [previewSuccess, setPreviewSuccess] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
  const hubId = useSession().currentHubId();

  const goBack = (currentStep > 0) ? () => onStepChange(currentStep - 1) : undefined;

  const {
    websiteUrl,
    templateUrl,
    multiPage,
    paginationStart,
    paginationEnd,
    linksCssSelector,
    titleCssSelector,
    bodyCssSelector,
  } = wizardState;

  const buildPayload = () => {
    return {
      source: {
        hub_id: hubId,
        name: isEditing ? source!.name : (suggestedName || websiteUrl),
        source_type: "website",
        active: source ? source.active : true,
        config: {
          base_url: templateUrl || websiteUrl,
          pagination_start: multiPage && paginationStart || undefined,
          pagination_end: multiPage && paginationEnd || undefined,
          post_link_selector: linksCssSelector,
          title_selector: titleCssSelector,
          body_selector: bodyCssSelector,
        },
      },
    };
  };

  const handlePreview = () => {
    const payload = buildPayload();
    setLoadingPreview(true);
    setSourcePreview([]);
    setSourcePreviewTotal(null);

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
      setPreviewSuccess(true);
    }).catch((error) => {
      setPreviewError(error?.message || String(error) || "Error");
      setPreviewSuccess(false);
      console.error("Error previewing Data Source:", error);
    }).finally(() => {
      setLoadingPreview(false);
    });
  };

  const handleCreateSource = () => {
    setIsSaving(true);
    const payload = buildPayload();
    createSource(payload).then((data) => {
      if (data.id) {
        onCreate(data.id);
      }
    }).catch((error) => {
      console.error("Error creating Data Source:", error);
    }).finally(() => {
      setIsSaving(false);
    });
  };

  const handleUpdateSource = (sourceId: number) => {
    setIsSaving(true);
    const payload = buildPayload();
    updateSource(sourceId, payload).then((data) => {
      if (data.id) {
        onCreate(data.id);
      }
    }).catch((error) => {
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
      disabled={!websiteUrl}
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
            id="global.articleListUrlLabel"
            defaultMessage="Article list URL"
            description="Label for the article list URL input field"
            tagName="strong"
          />
          <div className={styles.row}>
            {templateUrl || websiteUrl}
          </div>
        </div>
        {multiPage && (
          <div className={styles.wizardReviewItem}>
            <FormattedMessage
              id="websiteWizard.articlesToBeSynced"
              defaultMessage="Articles to be synced"
              description="Label for the pagination sync range review section in the website wizard"
              tagName="strong"
            />
            <div className={styles.row}>
              <FormattedMessage
                id="websiteWizard.articlesSyncRangeDescription"
                defaultMessage="Sync articles from page {startPage} to {endPage}"
                description="Description of the page range that will be synced, shown in the website wizard review step"
                values={{
                  startPage: paginationStart || 1,
                  endPage: paginationEnd || 100,
                }}
              />
            </div>
          </div>
        )}
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="websiteWizard.contentSelectors"
            defaultMessage="Content selectors"
            description="Label for CSS content selectors review section in the website wizard"
            tagName="strong"
          />
          <div className={styles.row}>
            <FormattedMessage
              id="websiteWizard.articleLinks"
              defaultMessage="Article links:"
              description=" Label for the article links CSS selector"
            />
            <span className={styles.highlight}>
              {linksCssSelector}
            </span>
          </div>
          <div className={styles.row}>
            <FormattedMessage
              id="global.title"
              defaultMessage="Title:"
              description=" Label for the article title CSS selector"
            />
            <span className={styles.highlight}>
              {titleCssSelector}
            </span>
          </div>
          <div className={styles.row}>
            <FormattedMessage
              id="global.articleBodyLabel"
              defaultMessage="Body:"
              description=" Label for the article body CSS selector"
            />
            <span className={styles.highlight}>
              {bodyCssSelector}
            </span>
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
                defaultMessage="Test successful"
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
                defaultMessage="Unable to retrieve articles. There may be something wrong with your configuration. Please verify your settings and retry. Contact our support team if you need help. The error is: {error}"
                description="Message displayed when unable to retrieve articles from a data source"
                values={{ error: <strong key="error">{previewError}</strong> }}
              />
            }
            actions={testButton}
          />
        )}
        {loadingPreview && (
          <div style={{ textAlign: 'center' }}>
            <PollingLoading size="medium" />
          </div>
        )}
        { sourcePreview.length > 0 && (
          <div className={styles.wizardSourcePreviewArea}>
            <ul>
              {sourcePreview.map(f => (
                <li key={f.external_id} id={`source-preview-entry-${f.external_id}`}>
                  <div className={styles.wizardsourcePreviewItem}>
                    <strong>{f.title}</strong>
                    {f.content && <div className={styles.content}>{f.content}</div>}
                    {f.link &&  (
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
        { previewSuccess && !sourcePreview.length && (
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
      { !readOnly && (
        <WizardStepFooter
          isEditing={isEditing}
          onCancel={onCancel}
          onGoBack={goBack}
          onComplete={() => {
            if(isEditing && source?.id) {
              handleUpdateSource(source.id);
            } else {
              handleCreateSource();
            }
          }}
          disableComplete={!previewSuccess || isSaving}
        />
      )}
    </>
  );
};

export default WebsiteWizard;
