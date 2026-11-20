import { FormattedDate, FormattedMessage } from 'react-intl';

import { datetimeFormatOptions } from '@helpers/platform-admin';

import type { AdminHubActivityEvent, AdminHubActivityEventType } from '@services/AdminService';

import EmptyState from '@ui-components/layout/EmptyState';
import { TableSkeleton } from '@ui-components/layout/LoadingIndicator';

import adminStyles from './PlatformAdmin.module.css';

const eventLabel = (type: AdminHubActivityEventType) => {
  switch (type) {
    case 'hub_created':
      return <FormattedMessage id="admin.hubDetailActivityHubCreated" defaultMessage="Hub created" description="Activity-timeline event label for a hub being created" />;
    case 'hub_deleted':
      return <FormattedMessage id="admin.hubDetailActivityHubDeleted" defaultMessage="Hub deleted" description="Activity-timeline event label for a hub being permanently deleted" />;
    case 'plan_changed':
      return <FormattedMessage id="admin.hubDetailActivityPlanChanged" defaultMessage="Plan changed" description="Activity-timeline event label for a hub changing plan" />;
    case 'deletion_requested':
      return <FormattedMessage id="admin.hubDetailActivityDeletionRequested" defaultMessage="Deletion requested" description="Activity-timeline event label for a hub being flagged for deletion" />;
    case 'membership_added':
      return <FormattedMessage id="admin.hubDetailActivityMembershipAdded" defaultMessage="Editor added" description="Activity-timeline event label for a member joining the hub" />;
    case 'membership_removed':
      return <FormattedMessage id="admin.hubDetailActivityMembershipRemoved" defaultMessage="Editor removed" description="Activity-timeline event label for a member leaving the hub" />;
    case 'source_added':
      return <FormattedMessage id="admin.hubDetailActivitySourceAdded" defaultMessage="Data source added" description="Activity-timeline event label for a data source being added" />;
    case 'source_removed':
      return <FormattedMessage id="admin.hubDetailActivitySourceRemoved" defaultMessage="Data source removed" description="Activity-timeline event label for a data source being removed" />;
    case 'document_first_synced':
      return <FormattedMessage id="admin.hubDetailActivityDocumentFirstSynced" defaultMessage="First document synced" description="Activity-timeline event label for the hub’s first document ever finishing sync" />;
    case 'messaging_connected':
      return <FormattedMessage id="admin.hubDetailActivityMessagingConnected" defaultMessage="Messaging connected" description="Activity-timeline event label for a messaging platform being connected" />;
    case 'messaging_disconnected':
      return <FormattedMessage id="admin.hubDetailActivityMessagingDisconnected" defaultMessage="Messaging disconnected" description="Activity-timeline event label for a messaging platform being disconnected" />;
    case 'trial_dates_changed':
      return <FormattedMessage id="admin.hubDetailActivityTrialDatesChanged" defaultMessage="Trial dates changed" description="Activity-timeline event label for a hub’s trial start or end date being edited" />;
    case 'custom_limits_changed':
      return <FormattedMessage id="admin.hubDetailActivityCustomLimitsChanged" defaultMessage="Custom limit changed" description="Activity-timeline event label for a hub’s custom plan limits being edited" />;
    case 'feature_flag_changed':
      return <FormattedMessage id="admin.hubDetailActivityFeatureFlagChanged" defaultMessage="Feature flag changed" description="Activity-timeline event label for a hub’s feature flag being toggled" />;
    case 'trial_emails_toggled':
      return <FormattedMessage id="admin.hubDetailActivityTrialEmailsToggled" defaultMessage="Trial emails toggled" description="Activity-timeline event label for a hub’s trial drip emails being enabled or disabled" />;
  }
};

interface HubActivityTimelineProps {
  events: AdminHubActivityEvent[];
  pending?: boolean;
}

const HubActivityTimeline = ({ events, pending = false }: HubActivityTimelineProps) => (
  <section>
    <FormattedMessage
      id="admin.hubDetailActivityTitle"
      defaultMessage="Activity timeline"
      description="Title for the activity-timeline section on the hub detail page"
      tagName="h2"
    />
    {pending ? (
      <TableSkeleton rows={5} />
    ) : events.length === 0 ? (
      <EmptyState
        layout="list"
        message={
          <FormattedMessage
            id="admin.hubDetailActivityEmpty"
            defaultMessage="No recorded activity for this hub"
            description="Shown when a hub has no activity-timeline events, e.g. one that predates the audit log"
          />
        }
      />
    ) : (
      <div className={adminStyles.tableWrapper}>
        <table>
          <thead>
            <tr>
              <th className={adminStyles.dateColumn}>
                <FormattedMessage
                  id="global.date"
                  defaultMessage="Date"
                  description="Generic label or title for a date value"
                />
              </th>
              <FormattedMessage
                id="admin.hubDetailActivityColumnEvent"
                defaultMessage="Event"
                description="Column header for the event type in the hub activity timeline"
                tagName="th"
              />
              <FormattedMessage
                id="admin.hubDetailActivityColumnDetail"
                defaultMessage="Detail"
                description="Column header for the event detail in the hub activity timeline"
                tagName="th"
              />
              <FormattedMessage
                id="admin.hubDetailActivityColumnActor"
                defaultMessage="Actor"
                description="Column header for who made the change in the hub activity timeline"
                tagName="th"
              />
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => (
              <tr key={`${event.type}-${event.at}-${i}`}>
                <td className={adminStyles.dateColumn}>
                  <FormattedDate value={event.at} {...datetimeFormatOptions} />
                </td>
                <td>{eventLabel(event.type)}</td>
                <td>{event.detail ?? '—'}</td>
                <td>{event.actor_email ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

export default HubActivityTimeline;
