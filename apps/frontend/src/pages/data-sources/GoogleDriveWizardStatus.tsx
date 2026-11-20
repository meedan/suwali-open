import { FormattedMessage } from "react-intl";

import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

export type ImportProgress = { fileName: string | null; index: number; total: number };

export const CopyProgress = ({ progress }: { progress: ImportProgress | null }) => {
  if (!progress) return null;

  return (
    <span>
      <PollingLoading size="small" />
      {progress.fileName ? (
        <FormattedMessage
          id="googleDriveWizard.copyingFile"
          defaultMessage="Copying {fileName}… ({index} of {total})"
          description="Progress message while a selected Google Drive file is being copied into the connected folder"
          values={{ fileName: <strong>{progress.fileName}</strong>, index: progress.index, total: progress.total }}
        />
      ) : (
        <FormattedMessage
          id="googleDriveWizard.preparingFolder"
          defaultMessage="Preparing your folder…"
          description="Progress message while the connected Google Drive folder is being created"
        />
      )}
    </span>
  );
};

export const ConnectError = ({ error }: { error: string | null }) => {
  if (!error) return null;

  return (
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
        <span>
          {error}
        </span>
      }
    />
  );
};

