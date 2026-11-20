import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { getUserFallback } from '@helpers/user';

import { fetchMe } from '@services/ProfileService';

import Avatar from '@ui-components/layout/Avatar';
import { Modal } from '@ui-components/layout/Modal';
import Tooltip from '@ui-components/layout/Tooltip.tsx';

import UserSettings from "@pages/user-settings/UserSettings";

import styles from './Me.module.css';

const messages = defineMessages({
  userSettingsTooltip: {
    id: 'me.userSettingsTooltip',
    defaultMessage: 'Manage your account',
    description: 'Tooltip and label for button to show the user settings area',
  },
  userSettingsModalTitle: {
    id: 'me.userSettingsModalTitle',
    defaultMessage: 'User settings',
    description: 'Title for dialog that shows the user settings',
  },
});

type MeProps = {
  avatarOnly?: boolean;
};

const loadingErrorState = <div className={styles.userMenuLoading}><VisuallyHidden.Root asChild><FormattedMessage id="global.loadingMessageloading" defaultMessage="Loading…" description="Loading message indicator that a section of the app is still loading" tagName="span" /></VisuallyHidden.Root></div>;

const Me = ({
  avatarOnly,
}: MeProps) => {
  const intl = useIntl();

  const { data, error, isPending } = useQuery({
    queryKey: ['/me'],
    queryFn: fetchMe,
  });

  if (isPending) return loadingErrorState;
  if (error) return loadingErrorState;

  const user = data || {};

  return (
    <Modal
      size="large"
      title={intl.formatMessage(messages.userSettingsModalTitle)}
      trigger={
        <Tooltip content={intl.formatMessage(messages.userSettingsTooltip)}>
          <div className={clsx(styles.userMenu, { [styles.avatarOnly]: avatarOnly })}
            aria-label={intl.formatMessage(messages.userSettingsTooltip)}
          >
            <Avatar
              picture={user?.profile_picture_url}
              name={user?.name}
              fallback={getUserFallback(user?.name, user?.email)}
              className={styles.meAvatar}
            />
          </div>
        </Tooltip>
      }
      body={<UserSettings />}
    >
    </Modal>
  );
};

export default Me;
