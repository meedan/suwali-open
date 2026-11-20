import { FormattedMessage } from 'react-intl';
import { Link } from 'react-router';

import { APP_NAME } from '@constants/App';

import { getDaysRemaining, isTrial } from '@helpers/trial';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import Icon from '@ui-components/layout/Icon';

import styles from './TrialDaysRemainingBanner.module.css';

const TrialDaysRemainingBanner = () => {
  const session = useSession();
  const hubPath = useHubPath();
  const hub = session.currentHub();
  const daysRemaining = hub ? getDaysRemaining(hub.trial_ends_at) : null;

  if (!hub || !isTrial(hub) || daysRemaining === null) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <Icon id="countdown" className={styles.icon} aria-hidden />
      <span>
        <FormattedMessage
          id="global.daysRemaining"
          defaultMessage="{days} {days, plural, one {Day} other {Days}} remaining on your {appName} free trial."
          description="Message showing how many days are left in the free trial"
          values={{ days: daysRemaining, appName: APP_NAME }}
        />
        {' '}
        <Link to={hubPath('/plans')} className={styles.upgradeLink}>
          <FormattedMessage
            id="global.upgradeName"
            defaultMessage="Upgrade to the full experience"
            description="Link text in the trial days remaining banner to upgrade to a premium plan"
          />
        </Link>
        {'.'}
      </span>
    </div>
  );
};

export default TrialDaysRemainingBanner;
