import { FormattedMessage } from 'react-intl';

import { useHubSettingsDialog } from '@hooks/useHubSettingsDialog';

import { Modal } from '@ui-components/layout/Modal';

import { Can } from '@components/Can';

import Settings from '@pages/hub-settings/HubSettings';

import styles from './HubSettings.module.css';

const HubSettings = () => {
  const { isOpen, tab, hasPendingApprovals, onOpenChange } = useHubSettingsDialog();

  return (
    <Modal
      open={isOpen}
      size="large"
      title={
        <FormattedMessage
          id="global.hubSettings"
          defaultMessage="System settings"
          description="Title for main navigation to go to the settings page for this system"
        />
      }
      titleContext={hasPendingApprovals ?
        <Can action="APPROVE_MEMBERSHIP">
          <div className={styles.pendingApprovalsBanner}>
            <span className={styles.pendingApprovalsIndicator} aria-hidden />
            <FormattedMessage
              id="global.pendingApprovalsDescription"
              defaultMessage="There are people waiting for account approval."
              description="Reusable label for showing that the system has pending approvals"
            />
          </div>
        </Can>
        : null
      }
      body={<Settings tab={tab} />}
      onOpenChange={onOpenChange}
    />
  );
};

export default HubSettings;
