import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { useHubSettingsDialog } from '@hooks/useHubSettingsDialog';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip.tsx';

import Hub from '@components/Hub';
import HubSettings from '@components/HubSettings';
import Me from '@components/Me';

import styles from './LayoutRail.module.css';

const messages = defineMessages({
  showHideMenu: {
    id: 'global.showHideMenu',
    defaultMessage: 'Show/Hide menu',
    description: 'Label for button to show or hide a menu',
  },
  hubSettings: {
    id: 'global.hubSettings',
    defaultMessage: 'System settings',
    description: 'Title for main navigation to go to the settings page for this system',
  },
});

type LayoutRailProps = {
  leftDrawerOpen: boolean;
  onLeftDrawerToggle: () => void;
};

const LayoutRail = ({ leftDrawerOpen, onLeftDrawerToggle }: LayoutRailProps) => {
  const intl = useIntl();
  const { openHubSettings } = useHubSettingsDialog();

  return (
    <header className={styles.rail}>
      <div className={styles.group}>
        <Hub avatar />
        <Tooltip
          content={
            <FormattedMessage
              id="global.showHideMenu"
              defaultMessage="Show/Hide menu"
              description="Label for button to show or hide a menu"
            />
          }
        >
          <Button
            aria-label={intl.formatMessage(messages.showHideMenu)}
            aria-expanded={leftDrawerOpen}
            themeMode
            variant="filled"
            size="small"
            iconLeft={leftDrawerOpen ? <Icon id="sidebar" aria-hidden /> : <Icon id="sidebar_closed" aria-hidden />}
            onClick={onLeftDrawerToggle}
          />
        </Tooltip>
      </div>
      <div className={styles.group}>
        <Tooltip
          content={
            <FormattedMessage
              id="global.hubSettings"
              defaultMessage="System settings"
              description="Title for main navigation to go to the settings page for this system"
            />
          }
        >
          <Button
            aria-label={intl.formatMessage(messages.hubSettings)}
            themeMode
            variant="filled"
            size="small"
            iconLeft={<Icon id="settings" aria-hidden />}
            onClick={openHubSettings}
          />
        </Tooltip>
        <Me />
      </div>
      <HubSettings />
    </header>
  );
};

export default LayoutRail;
