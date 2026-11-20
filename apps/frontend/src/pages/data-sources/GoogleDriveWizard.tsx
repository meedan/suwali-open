import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import type { PickedFile } from "@helpers/googleDriveConnect";

import Icon from "@ui-components/layout/Icon";

import type { WizardProps } from "./DataSourcesCreateWizard";
import GoogleDriveWizardChooseLocation from "./GoogleDriveWizardChooseLocation";
import GoogleDriveWizardReview from "./GoogleDriveWizardReview";
import GoogleDriveWizardSelectFiles from "./GoogleDriveWizardSelectFiles";
import styles from "./Wizard.module.css";

export type GoogleDriveWizardState = {
  folderUrl?: string;
  // Selected in the first step and used by the second one, which is where the
  // folder is created and the files are copied into it.
  pickedFiles?: PickedFile[];
  accessToken?: string | null;
  parentFolder?: PickedFile | null;
};

export type GoogleDriveWizardStepProps = WizardProps & {
  wizardState: GoogleDriveWizardState;
  setWizardState: (state: GoogleDriveWizardState) => void;
  readOnly?: boolean;
};

const getWizardHeading = () => ({
  icon: 'google_drive',
  label: (
    <FormattedMessage
      id="global.connectGoogleDrive"
      defaultMessage="Connect a Google Drive folder"
      description="Label for the connecting a google drive folder as a data source type"
    />
  ),
});

const getWizardSteps = () => {
  return [
    {
      label: (
        <FormattedMessage
          id="global.googleDriveSelectFiles"
          defaultMessage="Select files"
          description="Label for the Google Drive file selection step"
        />
      ),
      description: (
        <FormattedMessage
          id="global.googleDriveSelectFilesFromDrive"
          defaultMessage="Select your documents from Google Drive"
          description="Description for the Google Drive file selection step"
        />
      ),
    },
    {
      label: (
        <FormattedMessage
          id="global.googleDriveChooseLocation"
          defaultMessage="Choose location"
          description="Label for the Google Drive folder location step"
        />
      ),
      description: (
        <FormattedMessage
          id="global.googleDriveWhereFolderIsCreated"
          defaultMessage="Where the folder is created in your Drive"
          description="Description for the Google Drive folder location step"
        />
      ),
    },
  ];
};

const GoogleDriveWizard = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
}: WizardProps) => {
  const { config } = source || {};

  // Type assertion to treat config as the expected object shape
  const safeConfig = config as {
    folder_url?: string;
  } || {};

  const defaultState = {
    folderUrl: safeConfig.folder_url || '',
  } as GoogleDriveWizardState;

  const [wizardState, setWizardState] = useState<GoogleDriveWizardState>(defaultState);

  const handleCancel = () => {
    onStepChange(0);
    onCancel();
    setWizardState(defaultState);
  };

  // Editing view act on a folder that already
  // exists, so it shows the location step, where it can be moved.
  const step = isEditing ? 1 : currentStep;

  const wizardStepProps = {
    source,
    isEditing,
    isSetup,
    readOnly,
    onCancel: handleCancel,
    onCreate,
    onStepChange,
    currentStep: step,
    wizardState,
    setWizardState,
  } as GoogleDriveWizardStepProps;

  const heading = getWizardHeading();

  return (
    <div className={clsx(styles.wizardCard, { [styles.wizardSetupCard]: isSetup })}>
      {isSetup &&
        <div className={styles.dataSourceCreateWizareSetupTitle}>
          <Icon id={heading.icon} aria-hidden />
          <h6>{heading.label}</h6>
        </div>
      }
      {readOnly
        ? <GoogleDriveWizardReview {...wizardStepProps} />
        : step === 1
          ? <GoogleDriveWizardChooseLocation {...wizardStepProps} />
          : <GoogleDriveWizardSelectFiles {...wizardStepProps} />}
    </div>
  );
};

GoogleDriveWizard.getWizardSteps = getWizardSteps;
GoogleDriveWizard.getWizardHeading = getWizardHeading;

export default GoogleDriveWizard;
