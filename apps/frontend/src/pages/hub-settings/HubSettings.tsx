import { VisuallyHidden } from 'radix-ui';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { useCan } from '@hooks/useCapabilities';

import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';

import Fallback from '@layouts/error/Fallback';

import { Can } from '@components/Can';

import styles from '@pages/Settings.module.css'

import BillingSettings from "./Billing";
import MessagingIntegrationsSettings from "./MessagingIntegrations";
import ProfileSettings from "./Profile";
import TeamSettings from "./Team";

const messages = defineMessages({
  settings: {
    id: 'global.settingsMenu',
    defaultMessage: 'Settings menu',
    description: 'Reusable label for settings menu title',
  },
});

export type settingsTabs = 'profile' | 'team' | 'messaging-integrations' | 'billing';

type SettingsProps = {
  tab?: settingsTabs;
};

const Settings = ({ tab }: SettingsProps) => {
  const session = useSession();
  const hubId = session.currentHubId();

  const { data: hub } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId)
  });

  const defaultTab = useCan('UPDATE_HUB').allowed ? 'profile' : 'team';
  const settingValue = tab || defaultTab;
  const setSearchParams = useSearchParams()[1];

  const hasPendingApprovals = hub?.pending_approvals && hub.pending_approvals > 0;

  const handleToggle = (newValue: settingsTabs) => {
    if (newValue) {
      setSearchParams({ hubSettings: newValue });
    }
  };

  const intl = useIntl();

  return (
    <div className={styles.settingsWrapper}>
      <ToggleGroup
        className={styles.settingsMenu}
        variant="menu"
        type="single"
        defaultValue={defaultTab}
        aria-label={intl.formatMessage(messages.settings)}
        value={settingValue}
        onValueChange={handleToggle}
      >
        <Can action="UPDATE_HUB">
          <ToggleGroupItem value="profile" iconLeft={<Icon id="settings" aria-hidden />}>
            <FormattedMessage
              id="global.profile"
              defaultMessage="Profile"
              description="Reusable label for button or title for the user or system profile settings"
            />
          </ToggleGroupItem>
        </Can>
        <ToggleGroupItem value="team" iconLeft={<Icon id="organization" aria-hidden />}>
          <FormattedMessage
            id="settings.teamButtonLabel"
            defaultMessage="Team"
            description="Label for button to access the list of users of the system and their settings"
          />
          {/* Hidden text rather than an aria-label: a plain span has no role, so its aria-label goes unread.
              The text becomes part of the item's name instead, so it reads "Team Pending approvals". */}
          {hasPendingApprovals ?
            <span className={styles.pendingApprovalsIndicator}>
              <VisuallyHidden.Root>
                <FormattedMessage
                  id="global.pendingApprovals"
                  defaultMessage="Pending approvals"
                  description="Reusable label for showing that the system has pending approvals"
                />
              </VisuallyHidden.Root>
            </span>
            : null
          }
        </ToggleGroupItem>
        <ToggleGroupItem value="messaging-integrations" iconLeft={<Icon id="conversations" aria-hidden />}>
          <FormattedMessage
            id="global.messagingIntegrations"
            defaultMessage="Messaging integrations"
            description="Reusable label for the list of messaging integrations of the hub"
          />
        </ToggleGroupItem>
        <ToggleGroupItem value="billing" iconLeft={<Icon id="credit_card" aria-hidden />}>
          <FormattedMessage
            id="global.billingAndPlans"
            defaultMessage="Billing and plans"
            description="Reusable label for button or title for the user or system billing settings"
          />
        </ToggleGroupItem>
      </ToggleGroup>
      <div className={styles.settingContent}>
        <SuwaliErrorBoundary fallback={<Fallback actions={['tryAgain', 'contactSupport']} />}>
          { settingValue === 'profile' ? <Can action="UPDATE_HUB"><ProfileSettings /></Can> : null }
          { settingValue === 'team' ? <TeamSettings /> : null }
          { settingValue === 'messaging-integrations' ? <MessagingIntegrationsSettings /> : null }
          { settingValue === 'billing' ? <BillingSettings /> : null }
        </SuwaliErrorBoundary>
      </div>
    </div>
  );
};

export default Settings;
