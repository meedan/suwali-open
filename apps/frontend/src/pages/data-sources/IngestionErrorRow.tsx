import { FormattedMessage } from 'react-intl';

import type { IngestionError } from '@customTypes/source';

import DataSourceItemActionsMenu from '@components/DataSourceItemActionsMenu';
import DataSourceItemTitle from '@components/DataSourceItemTitle';

import styles from './DataSourcesDocumentsPanel.module.css';

const ReasonMessage = ({ reason, details }: Pick<IngestionError, 'reason' | 'details'>) => {
  switch (reason) {
    case 'unsupported_type':
      return (
        <FormattedMessage
          id="global.ingestionErrorUnsupportedType"
          defaultMessage="This file type isn’t supported ({details})."
          description="Reason shown when a file was skipped because its format is not supported. {details} is the file MIME type."
          values={{ details: details ?? '' }}
        />
      );
    case 'file_too_large':
      return (
        <FormattedMessage
          id="global.ingestionErrorFileTooLarge"
          defaultMessage="This file is too large to import."
          description="Reason shown when a file was skipped because it exceeds the size limit."
        />
      );
    case 'shortcut_target_inaccessible':
      return (
        <FormattedMessage
          id="global.ingestionErrorShortcutTargetInaccessible"
          defaultMessage="This shortcut’s target file isn’t shared with the importer."
          description="Reason shown when a Google Drive shortcut points to a file the importer cannot access."
        />
      );
    case 'folder_not_supported':
      return (
        <FormattedMessage
          id="global.ingestionErrorFolderNotSupported"
          defaultMessage="Subfolders aren’t imported. Move the files into the connected folder to import them."
          description="Reason shown when a Google Drive subfolder was skipped because only files directly inside the shared folder are imported."
        />
      );
    case 'import_failed':
      return (
        <FormattedMessage
          id="global.ingestionErrorImportFailed"
          defaultMessage="We couldn’t import this file. We’ll try again on the next sync."
          description="Reason shown when a file failed to import for an unexpected reason."
        />
      );
    case 'NO_TEXT_FOUND':
      return (
        <FormattedMessage
          id="dataSourcesDocumentsPanel.ingestionErrorNoTextFound"
          defaultMessage="We couldn’t find any text in this file."
          description="Reason shown when a document was imported but no readable text could be found in it."
        />
      );
    case 'TEXT_TOO_LARGE':
      return (
        <FormattedMessage
          id="dataSourcesDocumentsPanel.ingestionErrorTextTooLarge"
          defaultMessage="This file’s content is too large to process."
          description="Reason shown when a document was imported but its extracted text exceeds the size the system can process."
        />
      );
    default:
      return (
        <FormattedMessage
          id="global.ingestionErrorUnknown"
          defaultMessage="We couldn’t import this file."
          description="Fallback reason shown when a file could not be imported for an unrecognized reason."
        />
      );
  }
};

type Props = {
  error: IngestionError;
  lastSyncedAt?: string | null;
  showPublishedAt?: boolean;
  topicsColumn?: boolean;
  onDelete?: () => void;
};

const IngestionErrorRow = ({ error, lastSyncedAt, showPublishedAt, topicsColumn, onDelete }: Props) => (
  <tr className={styles.rowUnsupported}>
    <td className="table-priority-cell" />
    <td>
      <DataSourceItemTitle title={error.title} syncStatus="unsupported" />
      <span className={styles.errorReason}>
        <ReasonMessage reason={error.reason} details={error.details} />
      </span>
    </td>
    {showPublishedAt && <td>—</td>}
    {topicsColumn && <td />}
    <td title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}>
      {lastSyncedAt ? new Date(lastSyncedAt).toLocaleDateString() : '—'}
    </td>
    <td className="table-row-actions">
      <DataSourceItemActionsMenu
        item={{ id: 0 }}
        externalUrl={error.link ?? undefined}
        onDelete={onDelete}
      />
    </td>
  </tr>
);

export default IngestionErrorRow;
