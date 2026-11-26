import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { fetchAdminHubs, fetchInactiveUsers, fetchUnconfirmedUsers, fetchUsersPendingApproval, fetchUsersWithNoHub } from '@services/AdminService';

import usePageTitle from '@hooks/usePageTitle';

import Button, { ButtonLink } from '@ui-components/input/Button';

import { Can } from '@components/Can';

import AttentionList from './AttentionList';
import ChurnedHubsSection from './ChurnedHubsSection';
import CreateHubModal from './CreateHubModal';
import styles from './Dashboard.module.css';
import HubsSection from './HubsSection';
import PlatformAnalytics from './PlatformAnalytics';
import SuperAdminList from './SuperAdminList';
import SystemSection from './SystemSection';
import useAdminExport from './useAdminExport';

const messages = defineMessages({
  jumpLinksLabel: {
    id: 'admin.jumpLinksLabel',
    defaultMessage: 'Page sections',
    description: 'Accessible label for the jump links navigation on the admin dashboard',
  },
});

const Dashboard = () => {
  const intl = useIntl();
  const { exportingPath, error, handleExport } = useAdminExport();
  const [creatingHub, setCreatingHub] = useState(false);

  usePageTitle(
    <FormattedMessage
      id="admin.dashboardPageTitle"
      defaultMessage="Platform admin"
      description="Browser page title for the platform admin dashboard"
    />
  );

  const { data: hubs } = useQuery({
    queryKey: ['/admin/hubs'],
    queryFn: fetchAdminHubs,
    staleTime: 5 * 60 * 1000,
  });

  const { data: unconfirmedUsers } = useQuery({
    queryKey: ['/admin/users/unconfirmed'],
    queryFn: fetchUnconfirmedUsers,
    staleTime: 5 * 60 * 1000
  });

  const { data: usersWithNoHub } = useQuery({
    queryKey: ['/admin/users/no-hub'],
    queryFn: fetchUsersWithNoHub,
    staleTime: 5 * 60 * 1000
  });

  const { data: usersPendingApproval } = useQuery({
    queryKey: ['/admin/users/pending-approval'],
    queryFn: fetchUsersPendingApproval,
    staleTime: 5 * 60 * 1000
  });

  const { data: inactiveUsers } = useQuery({
    queryKey: ['/admin/users/inactive'],
    queryFn: fetchInactiveUsers,
    staleTime: 5 * 60 * 1000
  });

  return (
    <main className={styles.adminDashboardContainer}>
      <header>
        <FormattedMessage
          id="global.adminDashboardTitle"
          defaultMessage="Admin dashboard"
          description="Title for the admin dashboard page or link to the dashboard"
          tagName="h1"
        />
        <div className={styles.exportButtons}>
          <Can action="IS_WRITE_ADMIN">
            <Button
              label={<FormattedMessage id="admin.createHub" defaultMessage="Create hub" description="Button label for the action of creating a new hub. In English, “create” is a verb and “hub” its object; it is not a noun phrase such as “hub creation”." />}
              onClick={() => setCreatingHub(true)}
              size="small"
            />
            <CreateHubModal open={creatingHub} onOpenChange={setCreatingHub} />
          </Can>
          <ButtonLink
            label={<FormattedMessage id="admin.messageReportsLabel" defaultMessage="Message reports" description="Label for the button that opens the message reports page" />}
            to="/platform-admin/message-reports"
            size="small"
          />
          <ButtonLink
            label={<FormattedMessage id="admin.exportHubConversationsLabel" defaultMessage="Export hub conversations" description="Label for the button that opens the export hub conversations page, and that page’s title" />}
            to="/platform-admin/export-hub-conversations"
            size="small"
          />
          <Button
            label={exportingPath === '/admin/export/hubs'
              ? <FormattedMessage id="admin.exportingLabel" defaultMessage="Exporting…" description="Label for an export button while export is in progress" />
              : <FormattedMessage id="admin.exportHubsLabel" defaultMessage="Export hubs" description="Label for the button that exports hubs data" />
            }
            onClick={() => handleExport('/admin/export/hubs', 'suwali-hubs-export')}
            disabled={exportingPath !== null}
            size="small"
          />
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </header>
      <nav aria-label={intl.formatMessage(messages.jumpLinksLabel)} className={styles.jumpLinks}>
        <ol>
          <li>
            <a href="#system">
              <FormattedMessage
                id="admin.jumpSystem"
                defaultMessage="System"
                description="Jump link label to the system section of the admin dashboard"
              />
            </a>
          </li>
          <li>
            <a href="#analytics">
              <FormattedMessage
                id="admin.jumpAnalytics"
                defaultMessage="Analytics"
                description="Jump link label to the analytics section of the admin dashboard"
              />
            </a>
          </li>
          <li>
            <a href="#hubs">
              <FormattedMessage
                id="admin.jumpHubs"
                defaultMessage="Active hubs"
                description="Jump link label to the hubs section of the admin dashboard"
              />
            </a>
          </li>
          <li>
            <a href="#churned-hubs">
              <FormattedMessage
                id="admin.jumpChurnedHubs"
                defaultMessage="Churned hubs"
                description="Jump link label to the churned hubs section of the admin dashboard"
              />
            </a>
          </li>
          <li>
            <a href="#attention">
              <FormattedMessage id="admin.jumpAttention"
                defaultMessage="Users needing attention"
                description="Jump link label to the users needing attention section of the admin dashboard"
              />
            </a>
          </li>
          <Can action="IS_WRITE_ADMIN">
            <li>
              <a href="#platform-admins">
                <FormattedMessage
                  id="admin.jumpReadOnlySuperAdmins"
                  defaultMessage="Platform admins"
                  description="Jump link label to the platform admins section of the admin dashboard"
                />
              </a>
            </li>
          </Can>
        </ol>
      </nav>
      <SystemSection />
      <PlatformAnalytics />
      <HubsSection hubs={hubs} />
      <ChurnedHubsSection />
      <section id="attention">
        <FormattedMessage
          id="admin.attentionTitle"
          defaultMessage="Users needing attention"
          description="Title for the customer support attention section"
          tagName="h2"
        />
        <AttentionList
          iconId="error_filled"
          iconClassName={styles.attentionIconPink}
          title={
            <FormattedMessage
              id="admin.attentionPendingApprovalTitle"
              defaultMessage="Pending hub approval"
              description="Title for the pending approval attention list"
            />
          }
          description={
            <FormattedMessage
              id="admin.attentionPendingApprovalDescription"
              defaultMessage="Users who have requested to join a hub but have not been approved"
              description="Description for the pending approval attention list"
            />
          }
          users={usersPendingApproval}
          showHub
        />
        <AttentionList
          iconId="countdown_filled"
          iconClassName={styles.attentionIconYellow}
          title={
            <FormattedMessage
              id="admin.attentionUnconfirmedTitle"
              defaultMessage="Unconfirmed accounts"
              description="Title for the unconfirmed accounts attention list"
            />
          }
          description={
            <FormattedMessage
              id="admin.attentionUnconfirmedDescription"
              defaultMessage="Users who have not confirmed their email address"
              description="Description for the unconfirmed accounts attention list"
            />
          }
          users={unconfirmedUsers}
          showHub
          deleteAction={{ invalidateQueryKey: ['/admin/users/unconfirmed'] }}
        />
        <AttentionList
          iconId="triangle_dashed"
          iconClassName={styles.attentionIconOrange}
          title={
            <FormattedMessage
              id="admin.attentionNoHubTitle"
              defaultMessage="Not a member of any hub"
              description="Title for the no-hub attention list"
            />
          }
          description={
            <FormattedMessage
              id="admin.attentionNoHubDescription"
              defaultMessage="Users who have registered but are not a member of any hub"
              description="Description for the no-hub attention list"
            />
          }
          users={usersWithNoHub}
          showHub={false}
          deleteAction={{ invalidateQueryKey: ['/admin/users/no-hub'] }}
        />
        <AttentionList
          iconId="user_circle_dashed"
          iconClassName={styles.attentionIconGray}
          title={
            <FormattedMessage
              id="admin.attentionInactiveTitle"
              defaultMessage="Inactive editors"
              description="Title for the inactive editors attention list"
            />
          }
          description={
            typeof inactiveUsers?.threshold_days === 'number' ? (
              <FormattedMessage
                id="admin.attentionInactiveDescription"
                defaultMessage="{days, plural, one {Editors who have not used Suwali in the past day} other {Editors who have not used Suwali in the past # days}}"
                description="Description for the inactive editors attention list, where {days} is the number of days of inactivity"
                values={{ days: inactiveUsers.threshold_days }}
              />
            ) : null
          }
          users={inactiveUsers?.users}
          showHub
        />
      </section>
      <Can action="IS_WRITE_ADMIN">
        <SuperAdminList />
      </Can>
    </main>
  );
};

export default Dashboard;
