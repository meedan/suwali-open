import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchAbout } from "@services/AboutService";
import { createSourceWithFiles, updateSourceWithFiles } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";

import type { UploadedFilesWizardStepProps } from "./UploadedFilesWizard";
import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";

const messages = defineMessages({
  defaultSourceName: {
    id: "global.uploadedFilesDefaultSourceName",
    defaultMessage: "Uploaded files",
    description: "Default name for an uploaded files data source",
  },
});

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const UploadedFilesWizardUpload = ({
  source,
  isEditing,
  isSetup,
  readOnly,
  onCancel,
  onCreate,
  wizardState,
  setWizardState,
}: UploadedFilesWizardStepProps) => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: about } = useQuery({
    queryKey: ["/about"],
    queryFn: fetchAbout,
  });

  const allowedExtensions = about?.allowed_extensions || "...";
  const maxFileSize = about?.max_file_size || "...";
  const maxFilesPerUpload = about?.max_files_per_upload || 5;
  const acceptAttr = allowedExtensions
    .split(",")
    .map((ext) => `.${ext.trim().toLowerCase()}`)
    .join(",");

  useEffect(() => {
    if (wizardState.files.length === 0 && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [wizardState.files]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setWizardState({ ...wizardState, files: selectedFiles });
    setError(null);
  };

  const handleSubmit = () => {
    if (wizardState.files.length === 0) return;

    setIsSaving(true);
    setError(null);

    const request = isEditing && source?.id
      ? updateSourceWithFiles(source.id, wizardState.files)
      : hubId
        ? createSourceWithFiles(hubId, intl.formatMessage(messages.defaultSourceName), wizardState.files)
        : Promise.reject(new Error("Missing hub ID"));

    request
      .then((data) => {
        if (isEditing && source?.id) {
          queryClient.invalidateQueries({ queryKey: [`/sources/${source.id}/documents`] });
        }
        if (data.id) onCreate(data.id);
      })
      .catch((err) => {
        const errorMessage =
          err?.data?.errors?.join(", ") || err?.message || String(err);
        setError(errorMessage);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const hasFiles = wizardState.files.length > 0;

  return (
    <>
      {!isSetup && !isEditing &&
        <hgroup>
          <FormattedMessage
            id="global.uploadedFilesTitle"
            defaultMessage="Select and upload your documents to create a new data source of files"
            description="Title for the uploaded files wizard"
            tagName="h3"
          />
        </hgroup>
      }
      {!isSetup && isEditing &&
        <hgroup>
          <FormattedMessage
            id="global.uploadMoreFilesTitle"
            defaultMessage="Add more files to: {name}"
            description="Title for the uploading additional files wizard"
            tagName="h4"
            values={{
              name: source?.name
            }}
          />
        </hgroup>
      }
      <div className={styles.wizardCardBody}>
        <div className={styles.wizardFileUpload}>
          <Button
            variant="filled"
            themeMode={hasFiles}
            size="medium"
            label={
              hasFiles ? (
                <FormattedMessage
                  id="global.uploadedFilesSelectNewFiles"
                  defaultMessage="Select new files"
                  description="Button label to select new files when files are already selected"
                />
              ) : (
                <FormattedMessage
                  id="global.uploadedFilesSelectFiles"
                  defaultMessage="Select up to {maxFilesPerUpload} files"
                  description="Button label to open the file picker"
                  values={{ maxFilesPerUpload }}
                />
              )
            }
            onClick={() => fileInputRef.current?.click()}
          />
          {(isSetup || !isEditing) &&
            <FormattedMessage
              id="global.uploadedFilesAddMoreLater"
              defaultMessage="Don’t worry, you will be able to add more later."
              description="Hint that more files can be added later"
              tagName="span"
            />
          }
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr}
          multiple
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        {hasFiles && (
          <div className={clsx(styles.wizardSourcePreviewArea, styles.wizardSourcePreviewHasFiles)}>
            <ul>
              {wizardState.files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <div className={styles.wizardsourcePreviewItem}>
                    <span>
                      <strong>{file.name}</strong>
                      {" · "}
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasFiles && (
          <div className={clsx(styles.wizardSourcePreviewArea, styles.wizardSourcePreviewNoFiles)}>
            <FormattedMessage
              id="global.uploadedFilesNoFilesSelected"
              defaultMessage="No files currently selected."
              description="Placeholder text when no files have been selected"
            />
          </div>
        )}

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

        {error && (
          <HintBox
            type="error"
            title={
              <FormattedMessage
                id="global.formIssuesToFix"
                defaultMessage="There are some form issues that need to be fixed"
                description="Generic title for a form error summary"
              />
            }
            body={error}
          />
        )}
      </div>
      {!readOnly && (
        <WizardStepFooter
          isEditing={isEditing}
          onCancel={(isSetup || !isEditing || hasFiles) ? onCancel : undefined}
          completeLabel={
            <FormattedMessage
              id="global.uploadedFilesAddFiles"
              defaultMessage="Add files"
              description="Button label to submit the uploaded files"
            />
          }
          onComplete={handleSubmit}
          disableComplete={!hasFiles || isSaving}
        />
      )}
    </>
  );
};

export default UploadedFilesWizardUpload;
