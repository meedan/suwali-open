import { FormattedMessage } from 'react-intl';
import { Link } from 'react-router';

import { APP_NAME } from '@constants/App';

import { isTrial } from '@helpers/trial';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import { ButtonLink } from '@ui-components/input/Button';

import styles from './TrialMessagingBanner.module.css';

const TrialMessagingBanner = () => {
  const session = useSession();
  const hubPath = useHubPath();
  const hub = session.currentHub();

  if (!hub || !isTrial(hub)) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <p className={styles.description}>
        <FormattedMessage
          id="global.trialEndedMessaging"
          defaultMessage="Your free trial has ended, so connecting to messaging platforms is not available."
          description="Reusable text explaining that messaging platforms cannot be connected because the free trial has expired"
        />
      </p>
      <p className={styles.description}>
        <FormattedMessage
          id="trialMessagingBanner.description"
          defaultMessage="<link>Upgrade to the full experience</link> to connect one or many messaging apps and platforms to reach your audience."
          description="Description in the trial messaging banner. The link text triggers an upgrade flow."
          values={{
            link: (chunks) => <Link key="link" to={hubPath('/plans')} className={styles.link}>{chunks}</Link>,
          }}
        />
      </p>
      <div>
        <ButtonLink
          to={hubPath('/plans')}
          className={styles.button}
          label={
            <FormattedMessage
              id="trialMessagingBanner.upgradeButton"
              defaultMessage="Upgrade {appName}"
              description="Button label in the trial messaging banner"
              values={{ appName: APP_NAME }}
            />
          }
          size="small"
        />
      </div>
    </div>
  );
};

export default TrialMessagingBanner;
