import { FormattedMessage } from 'react-intl';
import { Link } from 'react-router';

import { getDaysRemaining, getTrialRemainingPercent, isTrial } from '@helpers/trial';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import ProgressBar from '@ui-components/layout/ProgressBar';

import styles from './TrialSidebarBanner.module.css';

const TrialSidebarBanner = () => {
  const session = useSession();
  const hubPath = useHubPath();
  const hub = session.currentHub();
  const daysRemaining = hub ? getDaysRemaining(hub.trial_ends_at) : null;

  if (!hub || !isTrial(hub) || daysRemaining === null) {
    return null;
  }

  const progressPercent = getTrialRemainingPercent(hub);

  return (
    <Link to={hubPath('/plans')} className={styles.banner}>
      <FormattedMessage
        id="global.trialDaysRemaining"
        defaultMessage="{days, plural, one {# day left on your free trial} other {# days left on your free trial}}"
        description="Number of days remaining shown in trial sidebar banner"
        values={{ days: daysRemaining }}
        tagName="p"
      />
      <ProgressBar fillPercent={progressPercent} minFillPercent={10} />
    </Link>
  );
};

export default TrialSidebarBanner;
