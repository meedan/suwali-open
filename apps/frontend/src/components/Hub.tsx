import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { NavLink } from 'react-router'
import { useQuery } from '@tanstack/react-query';

import { getPlanMessageDescriptor } from '@helpers/plan';

import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import Avatar from '@ui-components/layout/Avatar';

import styles from './Hub.module.css';

type HubProps = {
  avatar?: boolean;
  className?: string;
  name?: boolean;
};

const loadingErrorState = <div className={styles.hubAvatarLoading}><VisuallyHidden.Root asChild><FormattedMessage id="global.loadingMessageloading" defaultMessage="Loading…" description="Loading message indicator that a section of the app is still loading" tagName="span" /></VisuallyHidden.Root></div>;

const messages = defineMessages({
  dashboard: {
    id: 'global.dashboard',
    defaultMessage: 'Dashboard',
    description: 'Reusable label for Dashboard page or link title',
  },
});

const Hub = ({
  avatar,
  className,
  name,
}: HubProps) => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();

  const { data, error, isPending } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
  });

  if (isPending) return (avatar ? loadingErrorState : '…');
  if (error) return (avatar ? loadingErrorState : '…');

  const hub = data || {};

  return (
    <NavLink className={clsx(className, styles.hub)} to={hubPath('/dashboard')} title={intl.formatMessage(messages.dashboard)}>
      { avatar && (
        <Avatar
          picture={hub?.profile_picture_url}
          name={hub?.name}
          fallback={hub?.name.substring(0, 1)}
          className={styles.hubAvatar}
        />
      )}
      { name && (
        <div className={styles.hubName}>
          <FormattedMessage {...getPlanMessageDescriptor(hub)} tagName="small" />
          <span title={hub?.name}>{hub?.name}</span>
        </div>
      )}
    </NavLink>
  );
};

export default Hub;
