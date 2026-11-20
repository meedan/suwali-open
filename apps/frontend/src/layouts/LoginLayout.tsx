import { Outlet } from 'react-router'

import ThemeToggle from '@ui-components/input/ThemeToggle';
import Icon from '@ui-components/layout/Icon';

import styles from '@layouts/LoginLayout.module.css';

const LoginLayout = () => (
  <div className={styles.login}>
    <div className={styles.loginHeader}>
      <div className={styles.loginHeaderLogo}>
        <Icon id="suwali_logo_theme" aria-label="Suwali" />
      </div>
      <ThemeToggle />
    </div>
    <div className={styles.loginContainer}>
      <Outlet />
    </div>
  </div>
);

export default LoginLayout;
