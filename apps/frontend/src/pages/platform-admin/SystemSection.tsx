import { FormattedMessage, FormattedNumber } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { fetchPlatformStatistics } from '@services/AdminService';

import adminStyles from './PlatformAdmin.module.css';
import styles from './SystemSection.module.css';

const statCard = (key: string, label: React.ReactNode, value: number | undefined) => (
  <div key={key} className={adminStyles.statCard}>
    <dt>{label}</dt>
    <dd>
      {value != null ? <FormattedNumber value={value} /> : '—'}
    </dd>
  </div>
);

const SystemSection = () => {
  const { data } = useQuery({
    queryKey: ['/admin/statistics'],
    queryFn: () => fetchPlatformStatistics({ group_by: 'week' }),
    staleTime: 5 * 60 * 1000,
  });

  const counts = data?.global_counts;

  return (
    <section id="system" className={styles.systemEquation}>
      {/* Active + deleted = total only holds because every in-app deletion path requires a free
          plan first (see HubLifecycleService::FREE_PLAN_LABELS). A hub removed off that path
          (e.g. a Rails console delete of a paid hub) would make this sum look wrong — accepted,
          since that kind of deletion is the operator's responsibility to reconcile, not this UI's. */}
      <dl>
        {statCard('hubs', <FormattedMessage id="admin.statActiveHubs" defaultMessage="Active hubs" description="Label for the active (currently existing) hub count stat" />, counts?.hubs)}
        <div className={styles.operator} aria-hidden="true">+</div>
        {statCard('hubs_churned', <FormattedMessage id="admin.statHubsDeleted" defaultMessage="Deleted hubs" description="Label for the churned (deleted while on a free plan) hub count stat" />, counts?.hubs_churned)}
        <div className={styles.operator} aria-hidden="true">=</div>
        {statCard('hubs_all_time', <FormattedMessage id="admin.statHubsAllTime" defaultMessage="Total hubs (all time)" description="Label for the all-time hub count stat, including deleted hubs" />, counts?.hubs_all_time)}
      </dl>
    </section>
  );
};

export default SystemSection;
