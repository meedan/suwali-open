import { useMemo, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import { createFolderWithFiles, folderIdFromUrl, moveFolder, pickDriveParentFolder } from "@helpers/googleDriveConnect";

import { fetchAbout } from "@services/AboutService";
import { createSource } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import TextInput from '@ui-components/input/TextInput';

import type { GoogleDriveWizardStepProps } from "./GoogleDriveWizard";
import GoogleDriveWizardParentPicker from "./GoogleDriveWizardParentPicker";
import { ConnectError, CopyProgress, type ImportProgress } from "./GoogleDriveWizardStatus";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";

const messages = defineMessages({
  connectedFolderName: {
    id: 'googleDriveWizard.connectedFolderName',
    defaultMessage: '{hubName} - Suwali Files',
    description: 'Name of the folder created in the user’s Google Drive by the connect flow',
  },
  myDrive: {
    id: 'global.myDrive',
    defaultMessage: 'My Drive',
    description: 'Title or label of the main area of a user’s google drive',
  },
});

const GoogleDriveWizardChooseLocation = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: GoogleDriveWizardStepProps) => {
  const [connectBusy, setConnectBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const intl = useIntl();
  const session = useSession();
  const hubId = session.currentHubId();
  const folderName = intl.formatMessage(messages.connectedFolderName, { hubName: session.currentHub()?.name || 'Suwali' });

  const { data: about } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const shareEmail = about?.google_drive_share_email;
  const oauthClientId = about?.google_oauth_client_id;
  const pickerSettings = about?.google_picker_api_key && about?.google_picker_app_id ? {
    api_key: about.google_picker_api_key,
    app_id: about.google_picker_app_id,
  } : null;

  const pickedFiles = wizardState.pickedFiles || [];
  const parentFolder = wizardState.parentFolder;

  // A source that already has a folder URL is connected: this step then moves
  // that folder instead of creating one. Derived rather than stored, because the
  // settings page keeps this component mounted and only flips isEditing when the
  // user starts editing.
  // Sources connected before this wizard existed may hold a URL we can't read a
  // folder id from; they are still shown, but cannot be moved.
  const connectedFolder = useMemo(() => {
    if (!wizardState.folderUrl) return null;
    return { id: folderIdFromUrl(wizardState.folderUrl), name: source?.name || '', url: wizardState.folderUrl };
  }, [wizardState.folderUrl, source?.name]);

  const handleSelectParent = () => {
    if (!oauthClientId || !pickerSettings) return;
    setConnectBusy(true);
    setConnectError(null);
    pickDriveParentFolder(oauthClientId, pickerSettings, wizardState.accessToken).then((picked) => {
      if (!picked) return;
      setWizardState({ ...wizardState, accessToken: picked.accessToken, parentFolder: picked.folder });
    }).catch((error) => {
      setConnectError(error?.message || String(error));
    }).finally(() => {
      setConnectBusy(false);
    });
  };

  // Moving keeps the folder id, so the source stays connected and there is
  // nothing to save on our side.
  const handleMove = () => {
    const done = () => {
      if (source?.id) onCreate(source.id);
    };

    // Saving is only offered once a destination is chosen; a folder we can't
    // identify has no destination to move to.
    if (!wizardState.accessToken || !connectedFolder?.id || !parentFolder) {
      done();
      return;
    }
    const folderId = connectedFolder.id;
    setIsSaving(true);
    setConnectError(null);

    moveFolder(wizardState.accessToken, folderId, parentFolder.id).then(() => {
      // Reset the pending choice, so coming back later starts clean.
      setWizardState({ ...wizardState, parentFolder: null, accessToken: null });
      done();
    }).catch((error) => {
      setConnectError(error?.message || String(error));
    }).finally(() => {
      setIsSaving(false);
    });
  };

  // Everything that touches the user's Drive happens here, so leaving the wizard
  // before this point leaves their Drive untouched.
  const handleCreate = () => {
    if (!wizardState.accessToken || !shareEmail || !pickedFiles.length) return;
    setIsSaving(true);
    setConnectError(null);

    createFolderWithFiles(
      wizardState.accessToken,
      shareEmail,
      folderName,
      pickedFiles,
      (fileName, index, total) => setProgress({ fileName, index, total }),
      parentFolder?.id
    ).then(({ folder }) => {
      setWizardState({ ...wizardState, folderUrl: folder.url, pickedFiles: [], parentFolder: null, accessToken: null });
      return createSource({
        source: {
          hub_id: hubId,
          name: folder.name,
          source_type: "google_drive_folder",
          active: source ? source.active : true,
          config: {folder_url: folder.url},
        },
      });
    }).then((data) => {
      if (data.id) onCreate(data.id);
    }).catch((error) => {
      setConnectError(error?.message || String(error));
    }).finally(() => {
      setIsSaving(false);
      setProgress(null);
    });
  };

  return (
    <>
      {!isSetup &&
        <hgroup>
          {connectedFolder ? (
            <FormattedMessage
              id="googleDriveWizard.connectedExistingTitle"
              defaultMessage="Folder connected"
              description="Title for the hint box when the source’s Google Drive folder is already connected"
              tagName="h3"
            />
          ) : (
            <FormattedMessage
              id="googleDriveWizard.locationTitle"
              defaultMessage="Where in your Google Drive should we create the folder?"
              description="Title for the hint box where the user chooses the parent of the connected folder"
              tagName="h3"
            />
          )}
        </hgroup>
      }
      <div className={styles.wizardCardBody}>
        <>
          {connectedFolder ? (
            <>
              <FormattedMessage
                id="googleDriveWizard.connectedBody"
                defaultMessage="The folder is in your Google Drive, connected with <strong>read-only access</strong>. <link>Open it</link> to see your files — anything you add to it later will sync automatically."
                description="Description for the hint box after a connected Google Drive folder was created"
                tagName="p"
                values={{
                  link: msg => (
                    <a key="link" href={connectedFolder.url} target="_blank" rel="noopener noreferrer">{msg}</a>
                  ),
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
              <TextInput
                readOnly
                label={
                  <FormattedMessage
                    id="global.folder"
                    defaultMessage="Folder"
                    description="Title or label designating a folder"
                  />
                }
                required
                size="large"
                value={connectedFolder.url}
              />
              {parentFolder && (
                <TextInput
                  readOnly
                  label={
                    <FormattedMessage
                      id="googleDriveWizard.moveFolderTo"
                      defaultMessage="Move folder to"
                      description="Label for the display of a folder location on Google Drive"
                    />
                  }
                  required
                  size="large"
                  value={parentFolder.name}
                />
              )}
              {(// A folder we can't identify can't be moved.
                !connectedFolder || connectedFolder.id) && (
                  <GoogleDriveWizardParentPicker
                    parentFolder={parentFolder}
                    moving={!!connectedFolder}
                    disabled={connectBusy || isSaving}
                    onPick={handleSelectParent}
                    onReset={() => setWizardState({ ...wizardState, parentFolder: null })}
                  />
              )}
            </>
          ) : (
            <>
              <TextInput
                readOnly
                label={
                  <FormattedMessage
                    id="global.folderName"
                    defaultMessage="Folder name"
                    description="Title or label designating the name of a folder"
                  />
                }
                required
                size="large"
                value={folderName}
              />
              <TextInput
                readOnly
                label={
                  <FormattedMessage
                    id="global.folderLocation"
                    defaultMessage="Folder location"
                    description="Title or label designating the location of a folder"
                  />
                }
                helpContent={
                  <GoogleDriveWizardParentPicker
                    parentFolder={parentFolder}
                    moving={!!connectedFolder}
                    disabled={connectBusy || isSaving}
                    onPick={handleSelectParent}
                    onReset={() => setWizardState({ ...wizardState, parentFolder: null })}
                  />
                }
                required
                size="large"
                value={parentFolder ? parentFolder.name : intl.formatMessage(messages.myDrive)}
              />
            </>
          )}
          <CopyProgress progress={progress} />
          <ConnectError error={connectError} />
        </>
      </div>
      {!readOnly && (
        <WizardStepFooter
          isEditing={isEditing}
          onCancel={onCancel}
          onGoBack={connectedFolder ? undefined : () => onStepChange(currentStep - 1)}
          onComplete={connectedFolder ? handleMove : handleCreate}
          disableComplete={isSaving || connectBusy || (connectedFolder ? !parentFolder : !pickedFiles.length)}
        />
      )}
    </>
  );
};

export default GoogleDriveWizardChooseLocation;
