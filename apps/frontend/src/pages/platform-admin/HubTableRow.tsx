import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router';

import { hubPath } from '@helpers/hubPath';
import { dateFormatOptions, datetimeFormatOptions, formatLimit, formatMaxLimit, getActivityStatus, getDocumentActivityStatus, getEditorsStatus, getStatusTooltip, getTrialStatus, utcDateFormatOptions } from '@helpers/platform-admin';

import type { AdminHub } from '@services/AdminService';

import { useSession } from '@root/SessionContext';

import Button from '@ui-components/input/Button';

import adminStyles from './PlatformAdmin.module.css';
import StatusCell from './StatusCell';

const messages = defineMessages({
  unrestricted: {
    id: 'admin.unrestricted',
    defaultMessage: 'unrestricted',
    description: 'Label shown in place of a numeric limit when there is no restriction on a hub',
  },
});

interface HubTableRowProps {
  hub: AdminHub;
}

const HubTableRow = ({ hub }: HubTableRowProps) => {
  const intl = useIntl();
  const session = useSession();
  const navigate = useNavigate();
  const unlimitedLabel = intl.formatMessage(messages.unrestricted);
  const trialStatus = getTrialStatus(hub.trial_expired, hub.trial_ends_at);
  const trialTooltip = trialStatus
    ? <FormattedMessage
        {...getStatusTooltip('trial', trialStatus)}
        values={hub.trial_ends_at
          ? { date: <time key="date" dateTime={hub.trial_ends_at}><FormattedDate value={hub.trial_ends_at} {...utcDateFormatOptions} /></time> }
          : {}
        }
      />
    : undefined;

  const suppressExternalData = hub.trial_active && hub.plan !== 'free_unrestricted';
  const editorsStatus = getEditorsStatus(hub.unapproved_editors_count, hub.unconfirmed_editors_count);
  const editorsTooltip = <FormattedMessage {...getStatusTooltip('editors', editorsStatus)} />;

  const docStatus = getDocumentActivityStatus(hub.last_document_added_at);
  const docTooltip = hub.last_document_added_at
    ? <FormattedMessage
        {...getStatusTooltip('documents', docStatus)}
        values={{
          date: (
            <time
              key="date"
              dateTime={hub.last_document_added_at}
            >
              <FormattedDate value={hub.last_document_added_at} {...datetimeFormatOptions} />
            </time>
          )
        }}
      />
    : undefined;

  const internalStatus = getActivityStatus(hub.last_internal_conversation_at);
  const internalTooltip = hub.last_internal_conversation_at
    ? <FormattedMessage
        {...getStatusTooltip('conversations', internalStatus)}
        values={{
          date: (
            <time
              key="date"
              dateTime={hub.last_internal_conversation_at}
            >
              <FormattedDate value={hub.last_internal_conversation_at} {...datetimeFormatOptions} />
            </time>
          )
        }}
      />
    : undefined;

  const externalStatus = getActivityStatus(hub.last_external_conversation_at);
  const externalTooltip = hub.last_external_conversation_at
    ? <FormattedMessage
        {...getStatusTooltip('conversations', externalStatus)}
        values={{
          date: (
            <time
              key="date"
              dateTime={hub.last_external_conversation_at}
            >
              <FormattedDate value={hub.last_external_conversation_at} {...datetimeFormatOptions} />
            </time>
          )
        }}
      />
    :
      <FormattedMessage
        id="admin.hubDetailNeverExternalConversation"
        defaultMessage="No external conversations have been recorded"
        description="Tooltip shown on the last external conversation row when no conversations have ever occurred"
      />
    ;

  return (
    <tr>
      <td>
        <Link to={`/platform-admin/hubs/${hub.id}`}>{hub.name}</Link>
      </td>
      <StatusCell status={trialStatus} tooltip={trialTooltip}>
        {trialStatus
          ? hub.plan === 'free_unrestricted'
            ? <FormattedMessage id="global.freeTrialUnrestricted" defaultMessage="Free trial (unrestricted)" description="Plan label for an unrestricted free hub trial" />
            : <FormattedMessage id="global.freeTrial" defaultMessage="Free trial" description="Label indicating the free trial pricing tier" />
          : hub.plan}
      </StatusCell>
      <StatusCell status={editorsStatus} tooltip={editorsTooltip}>
        {hub.users_count}
      </StatusCell>
      <StatusCell status={!suppressExternalData && hub.active_external_users_count === 0 ? 'pink' : null}>
        {suppressExternalData ? '—' : hub.active_external_users_count.toLocaleString()}
      </StatusCell>
      <td>
        {formatMaxLimit(hub.max_messages, unlimitedLabel)}
      </td>
      <StatusCell status={hub.document_errors_count > 0 || hub.sources_count === 0 ? 'pink' : null}>
        {formatLimit(hub.sources_count, hub.max_sources, unlimitedLabel)}
      </StatusCell>
      <StatusCell status={docStatus} tooltip={docTooltip}>
        {formatLimit(hub.documents_count, hub.max_documents, unlimitedLabel)}
      </StatusCell>
      <StatusCell status={internalStatus} tooltip={internalTooltip} className={adminStyles.noTextColumn} />
      {suppressExternalData
        ? <td className={adminStyles.noTextColumn}>—</td>
        : <StatusCell status={externalStatus} tooltip={externalTooltip} className={adminStyles.noTextColumn} />
      }
      <td className={adminStyles.dateColumn}>
        <FormattedDate value={hub.created_at} {...dateFormatOptions} />
      </td>
      <td className={adminStyles.enterHub}>
        <Button
          label={
            <FormattedMessage
              id="admin.enterHub"
              defaultMessage="Enter hub"
              description="Button label to enter a hub as a super-admin"
            />
          }
          size="small"
          onClick={async () => {
            await session.setCurrentHubId(hub.id);
            navigate(hubPath('/dashboard', hub.id));
          }}
        />
      </td>
    </tr>
  );
};

export default HubTableRow;
