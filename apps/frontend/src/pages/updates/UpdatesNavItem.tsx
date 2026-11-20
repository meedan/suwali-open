import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { NavLink } from 'react-router';

import { useHubPath } from '@hooks/useHubPath';
import { useUpdates } from '@hooks/useUpdates';

import Icon from '@ui-components/layout/Icon';

import styles from './UpdatesNavItem.module.css';

const messages = defineMessages({
  updates: {
    id: 'global.updates',
    defaultMessage: 'Updates',
    description: 'Generic title or label for updates areas',
  },
  updatesUnread: {
    id: 'mainPagesNav.updatesUnread',
    defaultMessage: 'New updates available',
    description: 'Accessible label for the unread indicator badge on the Updates nav item',
  },
});

const UpdatesNavItem = () => {
  const intl = useIntl();
  const hubPath = useHubPath();
  const { unreadCount } = useUpdates();

  return (
    <div
      className={clsx(
        styles.updatesWrapper,
        { [styles.updatesUnread]: unreadCount > 0 }
      )}
    >
      <NavLink to={hubPath('/updates')} title={intl.formatMessage(messages.updates)}>
        <Icon id="megaphone" className={styles.updatesIcon} aria-hidden />
        <FormattedMessage
          id="global.suwaliUpdates"
          defaultMessage="Suwali updates"
          description="Navigation label for the product updates page"
          tagName="span"
        />
        <ins className={styles.updatesCount} aria-label={intl.formatMessage(messages.updatesUnread)}>{unreadCount > 9 ? '9+' : unreadCount}</ins>
        <Icon id="chevron_right" className={clsx(styles.updatesNavigate, 'icon-flip-rtl')} aria-hidden />
      </NavLink>
    </div>
  );
};

export default UpdatesNavItem;
