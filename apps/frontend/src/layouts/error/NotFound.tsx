import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import usePageTitle from '@hooks/usePageTitle';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './Error.module.css';

const NotFound = () => {
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const session = useSession();
  // When the URL's hub is the problem, hubPath would point back at it; an unprefixed path
  // resolves to the user's own default hub.
  const dashboardPath = session.hubUnavailable() ? '/dashboard' : hubPath('/dashboard');

  usePageTitle(
    <FormattedMessage
      id="global.notFoundPageTitle"
      defaultMessage="Page not found"
      description="Browser Page title for the not found error page"
    />
  );

  return (
    <div className={styles.wrapper}>
      <Icon className={styles.icon} id="triangle_dashed" />
      <FormattedMessage
        id="global.notFoundtitle"
        defaultMessage="This content is not available"
        description="Title displayed when a 404 error occurs in the app"
        tagName="h1"
      />
      <div className={styles.message}>
        <FormattedMessage
          id="global.notFoundmessage"
          defaultMessage="Return to your dashboard or check your permissions."
          description="Message displayed when a 404 error occurs in the app"
          tagName="p"
        />
      </div>
      <div className={styles.actions}>
        <Button
          onClick={() => navigate(dashboardPath)}
          iconLeft={<Icon id="house" aria-hidden />}
          label={
            <FormattedMessage
              id="global.fallbackAppbackHome"
              defaultMessage="Back to dashboard"
              description="Button to reload the page when an error occurs in the app"
            />
          }
        />
      </div>
    </div>
  );
};

export default NotFound;
