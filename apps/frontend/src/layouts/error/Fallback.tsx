import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';

import { SUPPORT_EMAIL } from '@constants/App';

import { useHubPath } from '@hooks/useHubPath';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './Error.module.css';

type FallbackProps = {
  actions?: ('backHome' | 'contactSupport' | 'tryAgain')[];
};

const Fallback = ({ actions }: FallbackProps) => {
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const backHome = actions?.includes('backHome');
  const contactSupport = actions?.includes('contactSupport');
  const tryAgain = actions?.includes('tryAgain');

  return (
    <div className={styles.wrapper}>
      <Icon className={styles.icon} id="error" />
      <FormattedMessage
        id="global.thatDidntWorkAsExpected"
        defaultMessage="That didn’t work as expected"
        description="Label displayed when an error occurs in the app"
        tagName="h1"
      />
      <div className={styles.message}>
        <FormattedMessage
          id="global.fallbackApptryRefreshing"
          defaultMessage="Try again or reach out to our support team."
          description="Message displayed when an error occurs in the app"
          tagName="p"
        />
      </div>
      <div className={styles.actions}>
        { tryAgain &&
          <Button
            onClick={() => window.location.reload()}
            iconLeft={<Icon id="arrow_clockwise" aria-hidden />}
            label={
              <FormattedMessage
                id="global.fallbackAppreloadButton"
                defaultMessage="Try again"
                description="Button to reload the page when an error occurs in the app"
              />
            }
            themeMode
          />
        }
        { backHome &&
          <Button
            onClick={() => navigate(hubPath('/dashboard'))}
            iconLeft={<Icon id="house" aria-hidden />}
            label={
              <FormattedMessage
                id="global.fallbackAppbackHome"
                defaultMessage="Back to dashboard"
                description="Button to reload the page when an error occurs in the app"
              />
            }
            themeMode
          />
        }
      </div>
      { contactSupport &&
        <div className={styles.contactSupport}>
          <FormattedMessage
            id="global.fallbackAppstillStuck"
            defaultMessage="Contact {helpLink} if this continues."
            description="Message displayed when an error occurs in the app"
            values={{
              helpLink: (
                <a href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                  {SUPPORT_EMAIL}
                </a>
              ),
            }}
          />
        </div>
      }
    </div>
  );
};

export default Fallback;
