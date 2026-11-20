import clsx from "clsx";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import Icon from "@ui-components/layout/Icon";

import type { WizardProps } from "./DataSourcesCreateWizard";
import UploadedFilesWizardUpload from "./UploadedFilesWizardUpload";
import styles from "./Wizard.module.css";

export type UploadedFilesWizardState = {
  files: File[];
};

export type UploadedFilesWizardStepProps = WizardProps & {
  wizardState: UploadedFilesWizardState;
  setWizardState: (state: UploadedFilesWizardState) => void;
};

const getWizardHeading = () => ({
  icon: 'upload_source',
  label: (
    <FormattedMessage
      id="global.uploadIndividualFiles"
      defaultMessage="Upload individual files"
      description="Label for the Uploaded individual files data source type"
    />
  ),
});

const getWizardSteps = () => {
  return [
    {
      label: (
        <FormattedMessage
          id="global.uploadedFilesUploadFiles"
          defaultMessage="Upload files"
          description="Label for the upload files step in the uploaded files wizard"
        />
      ),
      description: (
        <FormattedMessage
          id="global.uploadedFilesSelectAndUpload"
          defaultMessage="Select and upload your documents"
          description="Description for the upload files step"
        />
      ),
    },
  ];
};

const UploadedFilesWizard = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  onStepChange,
  currentStep,
}: WizardProps) => {
  const [wizardState, setWizardState] = useState<UploadedFilesWizardState>({
    files: [],
  });

  const handleCancel = () => {
    onStepChange(0);
    onCancel();
    setWizardState({ files: [] });
  };

  const wizardStepProps = {
    source,
    isEditing,
    isSetup,
    readOnly,
    onCancel: handleCancel,
    onCreate,
    onStepChange,
    currentStep,
    wizardState,
    setWizardState,
  } as UploadedFilesWizardStepProps;

  const heading = getWizardHeading();

  return (
    <div className={clsx(styles.wizardCard, { [styles.wizardSetupCard]: isSetup })}>
      {isSetup &&
        <div className={styles.dataSourceCreateWizareSetupTitle}>
          <Icon id={heading.icon} aria-hidden />
          <h6>{heading.label}</h6>
        </div>
      }
      <UploadedFilesWizardUpload {...wizardStepProps} />
    </div>
  );
};

UploadedFilesWizard.getWizardSteps = getWizardSteps;
UploadedFilesWizard.getWizardHeading = getWizardHeading;

export default UploadedFilesWizard;
