import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';
import { Outlet } from 'react-router'

import { SUPPORT_EMAIL } from '@constants/App';

import { useSession } from '@root/SessionContext.tsx'
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { useLogout } from '@hooks/useLogout';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import Fallback from '@layouts/error/Fallback';
import styles from '@layouts/InterstitialLayout.module.css';

type Props = {
  wide?: boolean;
};

const InterstitialLayout = ({ wide = false }: Props) => {
  const session = useSession();
  const handleLogout = useLogout();

  return (
    <SuwaliErrorBoundary fallback={<Fallback actions={['backHome', 'contactSupport', 'tryAgain']} />}>
      <div className={styles.interstitialWrapper}>
        <div className={styles.interstitialHeaderLogo}>
          <Icon id="suwali_logo_theme" aria-label="Suwali" />
        </div>
        <div className={clsx(styles.interstitialDialog, { [styles.wide]: wide })}>
          <Outlet />
        </div>
        {session.isLoggedIn() &&
          <Button
            iconLeft={<Icon id="sign_out" aria-hidden />}
            label={
              <FormattedMessage
                id="global.accountlogoutButton"
                defaultMessage="Sign out"
                description="Button label that allows the user to log out of the system"
              />
            }
            size="small"
            onClick={handleLogout}
            themeMode
          />
        }
        <FormattedMessage
          id="global.emailConfirmationquestions"
          defaultMessage="If you have any questions, get in touch at {helpLink}."
          description="Text for instructions on how to create an account"
          tagName="p"
          values={{
            helpLink: (
              <strong key="helpLink">
                <a href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                  {SUPPORT_EMAIL}
                </a>
              </strong>
            ),
          }}
        />
      </div>
    </SuwaliErrorBoundary>
  );
};

export default InterstitialLayout;
