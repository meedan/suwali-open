import { FormattedMessage } from 'react-intl';

import { useSession } from '@root/SessionContext';

import Icon from '@ui-components/layout/Icon';

import CopyToClipboardButton from './CopyToClipboardButton';
import styles from './UserAgentAllowlistHint.module.css';

const UserAgentAllowlistHint = () => {
  const { currentHub } = useSession();
  const userAgent = currentHub()?.user_agent || '';

  return (
    <FormattedMessage
      id="global.userAgentAllowlistHint"
      defaultMessage="If you need to allowlist our requests, you can do so by allowing the User-Agent: {userAgent}"
      description="Reminder instructions for allowlisting our crawler requests using a User-Agent"
      values={{
        userAgent: userAgent ? (
          <span key="userAgent">
            <br />
            <span className={styles.userAgent}>
              <strong>{userAgent}</strong>
              <CopyToClipboardButton
                iconLeft={<Icon id="clipboard" aria-hidden />}
                label={
                  <FormattedMessage
                    id="global.copy"
                    defaultMessage="Copy"
                    description="Reusable label for copy buttons"
                  />
                }
                size="small"
                variant="filled"
                themeMode
                value={userAgent}
              />
            </span>
          </span>
        ) : '…',
      }}
    />
  );
};

export default UserAgentAllowlistHint;
