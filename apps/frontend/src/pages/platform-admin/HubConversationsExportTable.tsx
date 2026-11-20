import { FormattedDate, FormattedMessage } from 'react-intl';

import type { BulkConversationExport } from '@customTypes/conversation';

import { datetimeFormatOptions } from '@helpers/platform-admin';

import EmptyState from '@ui-components/layout/EmptyState';

import adminStyles from './PlatformAdmin.module.css';

type HubConversationsExportTableProps = {
  latestExport: BulkConversationExport | null;
  downloadable: boolean;
};

const ExportStatus = ({ latestExport, downloadable }: { latestExport: BulkConversationExport; downloadable: boolean }) => {
  if (latestExport.status === 'pending') {
    return (
      <FormattedMessage
        id="global.statusPreparing"
        defaultMessage="Preparing…"
        description="Reusable status of an item that is still being prepared"
      />
    );
  }
  if (downloadable) {
    return (
      <FormattedMessage
        id="global.statusReady"
        defaultMessage="Ready"
        description="Reusable status of an item that is ready to use"
      />
    );
  }
  if (latestExport.status === 'failed') {
    return (
      <FormattedMessage
        id="global.statusFailed"
        defaultMessage="Failed"
        description="Reusable status of an item whose processing failed"
      />
    );
  }
  return (
    <FormattedMessage
      id="global.statusExpired"
      defaultMessage="Expired"
      description="Reusable status of an item that has expired"
    />
  );
};

const HubConversationsExportTable = ({ latestExport, downloadable }: HubConversationsExportTableProps) => {
  if (!latestExport) {
    return (
      <EmptyState
        layout="list"
        message={
          <FormattedMessage
            id="admin.exportHubConversations.empty"
            defaultMessage="This hub’s conversations have not been exported yet"
            description="Shown on the export hub conversations page when the selected hub has never been exported"
          />
        }
      />
    );
  }

  return (
    <div className={adminStyles.tableWrapper}>
      <table>
        <thead>
          <tr>
            <FormattedMessage id="global.requestedAt" defaultMessage="Requested at" description="Reusable table column header for when something was requested" tagName="th" />
            <FormattedMessage id="global.status" defaultMessage="Status" description="Reusable table column header or label for the status of an item" tagName="th" />
            <FormattedMessage id="admin.exportHubConversations.availableUntil" defaultMessage="Available until" description="Table column header for when the latest export of a hub’s conversations stops being downloadable" tagName="th" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><FormattedDate value={latestExport.created_at} {...datetimeFormatOptions} /></td>
            <td><ExportStatus latestExport={latestExport} downloadable={downloadable} /></td>
            <td>{downloadable ? <FormattedDate value={latestExport.expires_at} {...datetimeFormatOptions} /> : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default HubConversationsExportTable;
