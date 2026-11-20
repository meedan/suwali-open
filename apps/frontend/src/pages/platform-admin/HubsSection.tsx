import { useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';

import { getHubOverallStatus, type HubPlanFilter, type HubStatusFilter } from '@helpers/platform-admin';

import type { AdminHub } from '@services/AdminService';

import EmptyState from '@ui-components/layout/EmptyState';

import HubFilterControls from './HubFilterControls';
import HubTableRow from './HubTableRow';
import adminStyles from './PlatformAdmin.module.css';
import StatusLegend from './StatusLegend';

interface HubsSectionProps {
  hubs: AdminHub[] | undefined;
}

const HubsSection = ({ hubs }: HubsSectionProps) => {
  const [hubStatusFilter, setHubStatusFilter] = useState<HubStatusFilter>('all');
  const [hubPlanFilter, setHubPlanFilter] = useState<HubPlanFilter>('all');
  const [hubSearch, setHubSearch] = useState('');

  const hubCounts = useMemo(() => ({
    statuses: {
      green: hubs?.filter(h => getHubOverallStatus(h) === 'green').length ?? 0,
      yellow: hubs?.filter(h => getHubOverallStatus(h) === 'yellow').length ?? 0,
      pink: hubs?.filter(h => getHubOverallStatus(h) === 'pink').length ?? 0,
    },
    plans: {
      free: hubs?.filter(h => h.plan === 'free' && !h.trial_expired).length ?? 0,
      free_unrestricted: hubs?.filter(h => h.plan === 'free_unrestricted' && !h.trial_expired).length ?? 0,
      subsidized: hubs?.filter(h => h.plan === 'subsidized').length ?? 0,
      standard: hubs?.filter(h => h.plan === 'standard').length ?? 0,
      pro: hubs?.filter(h => h.plan === 'pro').length ?? 0,
      enterprise: hubs?.filter(h => h.plan === 'enterprise').length ?? 0,
      expired_trial: hubs?.filter(h => h.trial_expired).length ?? 0,
    },
  }), [hubs]);

  const filteredHubs = useMemo(() => {
    if (!hubs) return [];
    let result = hubs;
    if (hubStatusFilter !== 'all') {
      result = result.filter(h => getHubOverallStatus(h) === hubStatusFilter);
    }
    if (hubPlanFilter !== 'all') {
      result = result.filter(h =>
        hubPlanFilter === 'expired_trial'
          ? h.trial_expired
          : h.plan === hubPlanFilter && !h.trial_expired
      );
    }
    const term = hubSearch.trim().toLowerCase();
    if (term) {
      result = result.filter(h =>
        h.name.toLowerCase().includes(term)
      );
    }
    return result;
  }, [hubs, hubStatusFilter, hubPlanFilter, hubSearch]);

  return (
    <section id="hubs">
      <hgroup className={adminStyles.adminSectionHeaderGroup}>
        <FormattedMessage
          id="admin.hubsTitle"
          defaultMessage="Active hubs ({count})"
          description="Title for the active hubs table section"
          tagName="h2"
          values={{ count: hubs?.length ?? 0 }}
        />
        <StatusLegend />
      </hgroup>
      <HubFilterControls
        hubsCount={hubs?.length ?? 0}
        hubStatusFilter={hubStatusFilter}
        onStatusFilterChange={setHubStatusFilter}
        hubPlanFilter={hubPlanFilter}
        onPlanFilterChange={setHubPlanFilter}
        hubSearch={hubSearch}
        onSearchChange={setHubSearch}
        statusCounts={hubCounts.statuses}
        planCounts={hubCounts.plans}
      />
      <div className={adminStyles.tableWrapper}>
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>
                <FormattedMessage
                  id="global.name"
                  defaultMessage="Name"
                  description="Reusable label for item name"
                />
              </th>
              <th rowSpan={2}>
                <FormattedMessage
                  id="admin.hubsTablePlan"
                  defaultMessage="Plan"
                  description="Column header for hub plan in the hubs table"
                />
              </th>
              <th rowSpan={2}>
                <FormattedMessage
                  id="admin.hubsTableUsers"
                  defaultMessage="People"
                  description="Column header for user count in the hubs table"
                />
              </th>
              <th rowSpan={2}>
                <FormattedMessage
                  id="admin.hubsTableMonthlyContacts"
                  defaultMessage="Active end-users"
                  description="Column header for monthly active end-users in the hubs table"
                />
              </th>
              <th className={adminStyles.colGroupHeader} colSpan={3}>
                <FormattedMessage
                  id="admin.hubsTablePlanLimits"
                  defaultMessage="Plan limits"
                  description="Column group header for messages, data sources, and documents in the hubs table"
                />
              </th>
              <th className={adminStyles.colGroupHeader} colSpan={2}>
                <FormattedMessage
                  id="global.conversations"
                  defaultMessage="Conversations"
                  description="Reusable label for Conversations page or list title"
                />
              </th>
              <th className={adminStyles.dateColumn} rowSpan={2}>
                <FormattedMessage
                  id="admin.hubsTableCreatedAt"
                  defaultMessage="Created"
                  description="Column header for creation date in the hubs table"
                />
              </th>
              <th className={adminStyles.enterHub} rowSpan={2} />
            </tr>
            <tr>
              <FormattedMessage
                id="global.messages"
                defaultMessage="Messages"
                description="Reusable label for messages list or count"
                tagName="th"
              />
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
                tagName="th"
              />
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
                tagName="th"
              />
              <th className={adminStyles.noTextColumn}>
                <FormattedMessage
                  id="admin.hubsTableInternalActivity"
                  defaultMessage="Internal"
                  description="Column header for internal conversation activity in the hubs table"
                />
              </th>
              <th className={adminStyles.noTextColumn}>
                <FormattedMessage
                  id="admin.hubsTableExternalActivity"
                  defaultMessage="External"
                  description="Column header for external conversation activity in the hubs table"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredHubs.map((hub) => <HubTableRow key={hub.id} hub={hub} />)}
            {hubs && filteredHubs.length === 0 && (
              <tr>
                <td colSpan={12}>
                  <EmptyState
                    message={
                      hubStatusFilter === 'all' && hubPlanFilter === 'all' && !hubSearch.trim()
                        ? (
                          <FormattedMessage
                            id="admin.hubsEmpty"
                            defaultMessage="No hubs found"
                            description="Shown when the hubs table has no results"
                          />
                        ) : (
                          <FormattedMessage
                            id="admin.hubsFilteredEmpty"
                            defaultMessage="No hubs match this filter"
                            description="Shown when the hubs table filter returns no results"
                          />
                        )
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default HubsSection;
