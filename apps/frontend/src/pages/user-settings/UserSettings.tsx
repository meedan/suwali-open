import React from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { useLogout } from '@hooks/useLogout';

import Button from '@ui-components/input/Button';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';

import Fallback from '@layouts/error/Fallback';

import styles from '@pages/Settings.module.css'

import AccountSettings from "./Account";
import AppearanceSettings from "./Appearance";
import LanguageSettings from "./Language";
import ProfileSettings from "./Profile";

const messages = defineMessages({
  settings: {
    id: 'global.settingsMenu',
    defaultMessage: 'Settings menu',
    description: 'Reusable label for settings menu title',
  },
});

const UserSettings = () => {
  const [settingValue, setSettingValue] = React.useState('profile');
  const handleLogout = useLogout();

  const handleToggle = (newValue: string) => {
    if (newValue) {
      setSettingValue(newValue);
    }
  };

  const intl = useIntl();

  return (
    <div className={styles.settingsWrapper}>
      {/* Logout is an action rather than a choice, so it sits beside the menu rather than in it */}
      <div className={styles.settingsMenu}>
        <ToggleGroup
          className={styles.settingsMenuItems}
          type="single"
          defaultValue="profile"
          aria-label={intl.formatMessage(messages.settings)}
          variant="menu"
          value={settingValue}
          onValueChange={handleToggle}
        >
          <ToggleGroupItem value="profile" iconLeft={<Icon id="user_profile" aria-hidden />}>
            <FormattedMessage
              id="global.profile"
              defaultMessage="Profile"
              description="Reusable label for button or title for the user or system profile settings"
            />
          </ToggleGroupItem>
          <ToggleGroupItem value="appearance" iconLeft={<Icon id="sun" aria-hidden />}>
            <FormattedMessage
              id="me.appearanceButtonLabel"
              defaultMessage="Appearance"
              description="Label for button to access the Appearance settings to change theme of UI from light to dark modes"
            />
          </ToggleGroupItem>
          <ToggleGroupItem value="language" iconLeft={<Icon id="translate" aria-hidden />}>
            <FormattedMessage
              id="me.languageButtonLabel"
              defaultMessage="Language"
              description="Label for button to access the setting to change the UI language"
            />
          </ToggleGroupItem>
          <ToggleGroupItem value="account" iconLeft={<Icon id="lock" aria-hidden />}>
            <FormattedMessage
              id="me.accountButtonLabel"
              defaultMessage="Account & security"
              description="Label for button to the user account details, password, and privacy settings"
            />
          </ToggleGroupItem>
        </ToggleGroup>
        <div className={styles.settingLogout}>
          <Button
            iconLeft={<Icon id="sign_out" aria-hidden />}
            label={
              <FormattedMessage
                id="global.accountlogoutButton"
                defaultMessage="Sign out"
                description="Button label that allows the user to log out of the system"
              />
            }
            size="medium"
            onClick={handleLogout}
            themeMode
          />
        </div>
      </div>
      <div className={styles.settingContent}>
        <SuwaliErrorBoundary fallback={<Fallback actions={['tryAgain', 'contactSupport']} />}>
          { settingValue === 'profile' ? <ProfileSettings /> : null }
          { settingValue === 'appearance' ? <AppearanceSettings /> : null }
          { settingValue === 'language' ? <LanguageSettings /> : null }
          { settingValue === 'account' ? <AccountSettings /> : null }
        </SuwaliErrorBoundary>
      </div>
    </div>
  );
};

export default UserSettings;
