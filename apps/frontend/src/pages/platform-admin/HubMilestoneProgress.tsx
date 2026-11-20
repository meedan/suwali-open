import { FormattedDate, FormattedMessage } from 'react-intl';

import { datetimeFormatOptions } from '@helpers/platform-admin';

import type { AdminHubActivityEvent, AdminHubDetail } from '@services/AdminService';

import styles from './HubDetails.module.css';
import { daysSinceCreation, deriveMilestones, type MilestoneKey } from './hubMilestones';
import StatusValue from './StatusValue';

const milestoneLabel = (key: MilestoneKey) => {
  switch (key) {
    case 'hub_created':
      return <FormattedMessage id="admin.hubDetailMilestoneHubCreated" defaultMessage="Hub created" description="Milestone label for a hub being created" />;
    case 'source_added':
      return <FormattedMessage id="admin.hubDetailMilestoneSourceAdded" defaultMessage="Data source added" description="Milestone label for the hub’s first data source being added" />;
    case 'second_editor_joined':
      return <FormattedMessage id="admin.hubDetailMilestoneSecondEditorJoined" defaultMessage="Second editor joined" description="Milestone label for a second team member joining the hub, i.e. team growth beyond the creator" />;
    case 'messaging_connected':
      return <FormattedMessage id="admin.hubDetailMilestoneMessagingConnected" defaultMessage="Messaging connected" description="Milestone label for the hub’s first messaging platform being connected" />;
    case 'converted_to_paid':
      return <FormattedMessage id="admin.hubDetailMilestoneConvertedToPaid" defaultMessage="Converted to paid" description="Milestone label for the hub upgrading from a free plan to a paid one" />;
  }
};

interface HubMilestoneProgressProps {
  hub: Pick<AdminHubDetail, 'created_at'>;
  events: AdminHubActivityEvent[];
  pending?: boolean;
}

const HubMilestoneProgress = ({ hub, events, pending = false }: HubMilestoneProgressProps) => {
  // An empty event list is indistinguishable from one that hasn't loaded, and every milestone
  // would render as "Not yet" — an admin reading that as fact would conclude the hub never added
  // a source or converted, which is the opposite of what a slow load should imply.
  if (pending) return null;

  const milestones = deriveMilestones(hub, events);

  return (
    <section className={styles.milestoneProgress}>
      <ul>
        {milestones.map((milestone) => {
          const reached = milestone.at !== null;
          const days = reached && milestone.key !== 'hub_created' ? daysSinceCreation(hub.created_at, milestone.at!) : null;

          return (
            <li key={milestone.key}>
              <StatusValue status={reached ? 'green' : 'yellow'}>
                <div className={styles.milestoneLabel}>
                  <span>{milestoneLabel(milestone.key)}</span>
                  <span className={styles.milestoneDate}>
                    {!reached ? (
                      <FormattedMessage
                        id="admin.hubDetailMilestoneNotYet"
                        defaultMessage="Not yet"
                        description="Shown for a milestone the hub has not reached yet, styled as the page’s “worth checking” status"
                      />
                    ) : days === 0 ? (
                      <FormattedMessage
                        id="admin.hubDetailMilestoneSameDay"
                        defaultMessage="Same day"
                        description="Shown when a milestone was reached on the same day the hub was created"
                      />
                    ) : days !== null ? (
                      <FormattedMessage
                        id="admin.hubDetailMilestoneDaysAfterCreation"
                        defaultMessage="{days, plural, one {# day after creation} other {# days after creation}}"
                        description="Elapsed time between hub creation and a later milestone being reached"
                        values={{days}}
                      />
                    ) : null}
                  </span>
                  {reached && (
                    <time dateTime={milestone.at!}>
                      <FormattedDate value={milestone.at!} {...datetimeFormatOptions} />
                    </time>
                  )}
                </div>
              </StatusValue>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default HubMilestoneProgress;
