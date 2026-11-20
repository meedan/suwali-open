import clsx from 'clsx';
import { FormattedDate, FormattedMessage } from 'react-intl';
import { Link, useNavigate } from 'react-router';

import { hubPath } from '@helpers/hubPath';
import { datetimeFormatOptions } from '@helpers/platform-admin';

import type { AdminMessageReport } from '@services/AdminService';

import { useSession } from '@root/SessionContext';

import EmptyState from '@ui-components/layout/EmptyState';

import styles from './MessageReportsTable.module.css';
import adminStyles from './PlatformAdmin.module.css';

type MessageReportsTableProps = {
  reports: AdminMessageReport[];
};

const MessageReportsTable = ({ reports }: MessageReportsTableProps) => {
  const session = useSession();
  const navigate = useNavigate();

  // Same as the "Enter hub" button: remember the hub, then open its dashboard
  const enterHub = async (hubId: number) => {
    await session.setCurrentHubId(hubId);
    navigate(hubPath('/dashboard', hubId));
  };

  if (reports.length === 0) {
    return (
      <EmptyState
        layout="list"
        message={
          <FormattedMessage
            id="admin.messageReportsExport.empty"
            defaultMessage="No messages have been reported"
            description="Shown when there are no reported messages to list"
          />
        }
      />
    );
  }

  return (
    <div className={clsx(adminStyles.tableWrapper, styles.reportsTable)}>
      <table>
        <thead>
          <tr>
            <FormattedMessage id="admin.messageReportsExport.reportId" defaultMessage="ID" description="Table column header for the ID of a message report" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.hubId" defaultMessage="Hub ID" description="Table column header for the ID of the hub a reported message belongs to" tagName="th" />
            <FormattedMessage id="global.hub" defaultMessage="Hub" description="Reusable label or title for the word hub that describes an organization’s workspace" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.messageId" defaultMessage="Message ID" description="Table column header for the ID of a reported message, which links to the message" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.platform" defaultMessage="Platform" description="Table column header for the messaging platform of a reported message" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.userQuestion" defaultMessage="User question" description="Table column header for the question the user asked before the reported message" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.messageBody" defaultMessage="Reported message" description="Table column header for the text of the reported bot message" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.messageSentAt" defaultMessage="Message sent at" description="Table column header for when the reported message was sent" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.reportedBy" defaultMessage="Reported by" description="Table column header for the email of the person who reported a message" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.comment" defaultMessage="Comment" description="Table column header for the comment left with a message report" tagName="th" />
            <FormattedMessage id="admin.messageReportsExport.reportedAt" defaultMessage="Reported at" description="Table column header for when a message was reported" tagName="th" />
          </tr>
        </thead>
        <tbody>
          {reports.map(report => (
            <tr key={report.id}>
              <td>{report.id}</td>
              <td>{report.hub_id ?? '—'}</td>
              <td>{report.hub_id ? <Link
                to={hubPath('/dashboard', report.hub_id)}
                onClick={(event) => {
                  event.preventDefault();
                  enterHub(report.hub_id!);
                }}
              >
                {report.hub_name}
              </Link> : '—'}</td>
              <td>{report.message_link ? <a href={report.message_link}>{report.message_id}</a> : report.message_id}</td>
              <td>{report.platform ?? '—'}</td>
              <td className={styles.wrap}>{report.user_question ?? '—'}</td>
              <td className={styles.wrap}>{report.message_body ?? '—'}</td>
              <td>{report.message_sent_at ? <FormattedDate value={report.message_sent_at} {...datetimeFormatOptions} /> : '—'}</td>
              <td>{report.reported_by_email ?? '—'}</td>
              <td className={styles.wrap}>{report.comment ?? '—'}</td>
              <td><FormattedDate value={report.created_at} {...datetimeFormatOptions} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MessageReportsTable;
