import { FormattedDate, FormattedMessage } from 'react-intl';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { dateFormatOptions } from '@helpers/platform-admin';

import { fetchPlatformStatistics } from '@services/AdminService';

import EmptyState from '@ui-components/layout/EmptyState';

import adminStyles from './PlatformAdmin.module.css';

const ChurnedHubsSection = () => {
  const { data } = useQuery({
    queryKey: ['/admin/statistics'],
    queryFn: () => fetchPlatformStatistics({ group_by: 'week' }),
    staleTime: 5 * 60 * 1000,
  });

  const churnedHubs = data?.churned_hubs ?? [];

  return (
    <section id="churned-hubs">
      <FormattedMessage
        id="admin.churnedHubsTitle"
        defaultMessage="Churned hubs ({count})"
        description="Title for the churned-hubs table section on the admin dashboard"
        tagName="h2"
        values={{ count: churnedHubs.length }}
      />
      {churnedHubs.length === 0 ? (
        <EmptyState
          layout="list"
          message={
            <FormattedMessage
              id="admin.churnedHubsEmpty"
              defaultMessage="No hubs have churned"
              description="Shown when there are no churned hubs to list"
            />
          }
        />
      ) : (
        <div className={adminStyles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <FormattedMessage
                  id="global.hub"
                  defaultMessage="Hub"
                  description="Reusable label or title for the word hub that describes an organization’s workspace"
                  tagName="th"
                />
                <FormattedMessage
                  id="global.organization"
                  defaultMessage="Organization"
                  description="Generic label or title for an organization in the system items"
                  tagName="th"
                />
                <FormattedMessage
                  id="global.planAtDeletion"
                  defaultMessage="Plan at deletion"
                  description="Label for the hub’s plan at the time it was deleted"
                  tagName="th"
                />
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="global.created"
                    defaultMessage="Created"
                    description="Generic label or title for created items"
                  />
                </th>
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="global.deleted"
                    defaultMessage="Deleted"
                    description="Generic label or title for deleted items"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {churnedHubs.map((hub) => (
                <tr key={hub.hub_id}>
                  <td><Link to={`/platform-admin/hubs/${hub.hub_id}/deleted`}>{hub.hub_name}</Link></td>
                  <td>{hub.organization_name ?? '—'}</td>
                  <td>{hub.plan_at_deletion}</td>
                  <td className={adminStyles.dateColumn}><FormattedDate value={hub.created_at} {...dateFormatOptions} /></td>
                  <td className={adminStyles.dateColumn}><FormattedDate value={hub.deleted_at} {...dateFormatOptions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ChurnedHubsSection;
