import { FormattedMessage } from "react-intl";

import type { PickedFile } from "@helpers/googleDriveConnect";

import Button from "@ui-components/input/Button";

import styles from "./GoogleDriveWizardParentPicker.module.css";

type GoogleDriveWizardParentPickerProps = {
  parentFolder?: PickedFile | null;
  // A folder that already exists is moved into the chosen one, rather than created there.
  moving?: boolean;
  disabled?: boolean;
  onPick: () => void;
  onReset: () => void;
};

const GoogleDriveWizardParentPicker = ({
  parentFolder,
  moving,
  disabled,
  onPick,
  onReset,
}: GoogleDriveWizardParentPickerProps) => (
  <span className={styles.googleParentPicker}>
    <Button
      id="google-drive-choose-parent"
      variant="filled"
      size="small"
      disabled={disabled}
      label={
        parentFolder ? (
          <FormattedMessage
            id="googleDriveWizard.changeParentButton"
            defaultMessage="Choose a different location"
            description="Button label to pick another parent folder for the connected Google Drive folder"
          />
        ) : moving ? (
          <FormattedMessage
            id="googleDriveWizard.moveFolderButton"
            defaultMessage="Move folder"
            description="Button label to pick a new parent for the already connected Google Drive folder"
          />
        ) : (
          <FormattedMessage
            id="googleDriveWizard.changeParentButton"
            defaultMessage="Choose a different location"
            description="Button label to pick another parent folder for the connected Google Drive folder"
          />
        )
      }
      onClick={onPick}
    />
    {parentFolder && !moving && (
      <Button
        id="google-drive-reset-parent"
        variant="text"
        size="small"
        themeMode
        disabled={disabled}
        label={
          <FormattedMessage
            id="googleDriveWizard.useMyDriveButton"
            defaultMessage="Use My Drive"
            description="Button label to create the connected folder in the root of My Drive"
          />
        }
        onClick={onReset}
      />
    )}
  </span>
);

export default GoogleDriveWizardParentPicker;
