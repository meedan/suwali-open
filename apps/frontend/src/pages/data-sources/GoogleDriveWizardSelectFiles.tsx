import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import { pickDriveFiles } from "@helpers/googleDriveConnect";

import { fetchAbout } from "@services/AboutService";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";

import type { GoogleDriveWizardStepProps } from "./GoogleDriveWizard";
import { ConnectError } from "./GoogleDriveWizardStatus";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";

const GoogleDriveWizardSelectFiles = ({
  isSetup,
  readOnly,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: GoogleDriveWizardStepProps) => {
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data: about, isPending: aboutPending } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const pickedFiles = wizardState.pickedFiles || [];

  const oauthClientId = about?.google_oauth_client_id;
  const pickerSettings = about?.google_picker_api_key && about?.google_picker_app_id ? {
    api_key: about.google_picker_api_key,
    app_id: about.google_picker_app_id,
  } : null;
  const maxFiles = about?.max_files_per_upload;

  // Assumed configured while /about is still loading, so the unavailable
  // message never flashes on screen before being replaced.
  const configured = aboutPending || !!(oauthClientId && pickerSettings && about?.google_drive_share_email && maxFiles);

  const handleSelectFiles = () => {
    if (!oauthClientId || !pickerSettings || !maxFiles) return;
    setConnectBusy(true);
    setConnectError(null);
    pickDriveFiles(oauthClientId, pickerSettings, maxFiles).then((picked) => {
      if (!picked) return;
      setWizardState({ ...wizardState, accessToken: picked.accessToken, pickedFiles: picked.files });
    }).catch((error) => {
      setConnectError(error?.message || String(error));
    }).finally(() => {
      setConnectBusy(false);
    });
  };

  const handleCancel = () => {
    setConnectError(null);
    onCancel();
  };

  return (
    <>
      {!isSetup &&
        <hgroup>
          <FormattedMessage
            id="global.locateGoogleDriveFilesToBeAdded"
            defaultMessage="Locate the initial files to add from Google Drive"
            description="Title for the Data Source configuration wizard step for Google Drive files"
            tagName="h3"
          />
        </hgroup>
      }
      <div className={styles.wizardCardBody}>
        {configured ? (
          <>
            <FormattedMessage
              id="googleDriveWizard.connectBody"
              defaultMessage="A <strong>folder will be created</strong> in your Google Drive with a copy of the files you select, connected to Suwali with <strong>read-only access</strong>."
              description="Continued description for the hint box offering to connect Google Drive via Google sign-in"
              tagName="p"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
              }}
            />
            <FormattedMessage
              id="global.connectBodyContinued"
              defaultMessage="Anything you add to the folder in the future will <strong>sync automatically</strong> — nothing else in your Google Drive is shared."
              description="Continued description for the hint box offering to connect Google Drive via Google sign-in"
              tagName="p"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
              }}
            />
            <div className={styles.wizardFileUpload}>
              <Button
                id="google-drive-connect"
                variant="filled"
                themeMode={pickedFiles.length > 0}
                size="medium"
                disabled={connectBusy || aboutPending}
                label={
                  pickedFiles.length ? (
                    <FormattedMessage
                      id="googleDriveWizard.changeSelectionButton"
                      defaultMessage="Select different files"
                      description="Button label to replace the Google Drive files selected so far"
                    />
                  ) : (
                    <FormattedMessage
                      id="googleDriveWizard.connectButton"
                      defaultMessage="Select files from Google Drive"
                      description="Button label to connect Google Drive and select files via Google sign-in"
                    />
                  )
                }
                onClick={handleSelectFiles}
              />
              <FormattedMessage
                id="global.uploadedFilesAddMoreLater"
                defaultMessage="Don’t worry, you will be able to add more later."
                description="Hint that more files can be added later"
                tagName="span"
              />
            </div>
            {pickedFiles.length > 0 ? (
              <div className={clsx(styles.wizardSourcePreviewArea, styles.wizardSourcePreviewHasFiles)}>
                <ul>
                  {pickedFiles.map((file) => (
                    <li key={file.id}>
                      <div className={styles.wizardsourcePreviewItem}>
                        <span>
                          <strong>{file.name}</strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className={clsx(styles.wizardSourcePreviewArea, styles.wizardSourcePreviewNoFiles)}>
                <FormattedMessage
                  id="global.uploadedFilesNoFilesSelected"
                  defaultMessage="No files currently selected."
                  description="Placeholder text when no files have been selected"
                />
              </div>
            )}
            <ConnectError error={connectError} />
            <HintBox
              type="info"
              body={
                <FormattedMessage
                  id="googleDriveWizard.browserExtensionTip"
                  defaultMessage="<strong>Tip:</strong> If you experience issues, you may need to adjust browser privacy settings or extensions to allow access to your Google account."
                  description="Tip for user who may have privacy browser extensions that would limit access to google accounts"
                  tagName="p"
                  values={{
                    strong: msg => <strong key="strong">{msg}</strong>,
                  }}
                />
              }
            />
          </>
        ) : (
          <HintBox
            type="warning"
            title={
              <FormattedMessage
                id="googleDriveWizard.unavailableTitle"
                defaultMessage="Google Drive is not available"
                description="Title shown when the Google Drive integration is not configured on the server"
              />
            }
            body={
              <FormattedMessage
                id="googleDriveWizard.unavailableBody"
                defaultMessage="This installation is not set up to connect to Google Drive. Please contact your administrator."
                description="Message shown when the Google Drive integration is not configured on the server"
              />
            }
          />
        )}
      </div>
      {!readOnly && (
        <WizardStepFooter
          onCancel={handleCancel}
          onGoNext={() => onStepChange(currentStep + 1)}
          disableNext={!pickedFiles.length || connectBusy}
        />
      )}
    </>
  );
};

export default GoogleDriveWizardSelectFiles;
