import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import { fetchAbout } from "@services/AboutService";

import { ButtonLink } from '@ui-components/input/Button';
import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";

import type { GoogleDriveWizardStepProps } from "./GoogleDriveWizard";
import styles from "./Wizard.module.css";

// Settings view of a connected source: there is nothing to act on, so the
// folder is shown as plain information, like the other source types do.
const GoogleDriveWizardReview = ({ isSetup, wizardState }: GoogleDriveWizardStepProps) => {
  const { data: about } = useQuery({
    queryKey: ["/about"],
    queryFn: fetchAbout,
  });

  if (!wizardState.folderUrl) return null;

  const allowedExtensions = about?.allowed_extensions || "...";
  const maxFileSize = about?.max_file_size || "...";

  return (
    <>
      {!isSetup &&
        <hgroup>
          <FormattedMessage
            id="global.reviewConfiguration"
            defaultMessage="Review configuration"
            description="Title for the data source configuration summary"
            tagName="h3"
          />
        </hgroup>
      }
      <div className={styles.wizardCardBody}>
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="googleDriveWizard.reviewSubtitle"
            defaultMessage="Google Drive folder connected to this data source"
            description="Subtitle for the Google Drive data source configuration summary"
            tagName="strong"
          />
          <div className={styles.row}>
            <a href={wizardState.folderUrl} target="_blank" rel="noopener noreferrer">{wizardState.folderUrl}</a>
            <ButtonLink
              iconRight={<Icon id="arrow_square_out" />}
              size="small"
              themeMode
              label={
                <FormattedMessage
                  id="global.openFolder"
                  defaultMessage="Open folder"
                  description="Label for action to open a folder"
                />
              }
              key="button"
              to={wizardState.folderUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          </div>
          <HintBox
            type="info"
            body={
              <FormattedMessage
                id="global.connectBodyContinued"
                defaultMessage="Anything you add to the folder in the future will <strong>sync automatically</strong> — nothing else in your Google Drive is shared."
                description="Continued description for the hint box offering to connect Google Drive via Google sign-in"
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
            }
          />
        </div>
        <div className={styles.wizardReviewItem}>
          <FormattedMessage
            id="global.supportedFile"
            defaultMessage="Supported files"
            description="Title or label for list of file requirements and support"
            tagName="strong"
          />
          <div className={styles.wizardSourcePreviewArea}>
            <ul>
              <FormattedMessage
                id="global.uploadedFilesSupportedFormats"
                defaultMessage="Supported formats: <strong>{allowedExtensions}</strong>"
                description="Supported file formats info"
                tagName="li"
                values={{
                  allowedExtensions,
                  strong: (msg: React.ReactNode) => <strong key="formats">{msg}</strong>,
                }}
              />
              <FormattedMessage
                id="global.uploadedFilesMaxFileSize"
                defaultMessage="Maximum file size: <strong>{maxFileSize}</strong>"
                description="Maximum file size info"
                tagName="li"
                values={{
                  maxFileSize,
                  strong: (msg: React.ReactNode) => <strong key="size">{msg}</strong>,
                }}
              />
            </ul>
          </div>
        </div>
      </div>
    </>
  );
};

export default GoogleDriveWizardReview;
