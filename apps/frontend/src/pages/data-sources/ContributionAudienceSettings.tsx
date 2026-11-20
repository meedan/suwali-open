import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useQueryClient } from "@tanstack/react-query";

import type { Hub } from '@customTypes/hub';

import { updateContributionAudience } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import RadioCard from '@ui-components/layout/RadioCard';

import ConfirmContributionAudienceModal from './ConfirmContributionAudienceModal';
import styles from './DataSourcesContributionsSettings.module.css';
import TrustedEndUsersSettings from './TrustedEndUsersSettings';

const messages = defineMessages({
  updateSuccess: {
    id: 'global.contributionAudienceUpdateSuccess',
    defaultMessage: 'Audience requirement updated.',
    description: 'Toast message shown when the contribution audience is updated successfully',
  },
  updateError: {
    id: 'global.contributionAudienceUpdateError',
    defaultMessage: 'Failed to update audience requirement.',
    description: 'Toast message shown when the contribution audience update fails',
  },
});

const strong = (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>;

type ContributionAudienceSettingsProps = {
  onClose: () => void;
};

const ContributionAudienceSettings = ({ onClose }: ContributionAudienceSettingsProps) => {
  const intl = useIntl();
  const session = useSession();
  const hub = session.currentHub();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedAudience = hub!.contribution_audience;
  const [audience, setAudience] = useState<Hub['contribution_audience']>(savedAudience);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasChanges = audience !== savedAudience;

  const handleConfirm = () => {
    updateContributionAudience(hub!.id, audience)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hub!.id}`] });
        setConfirmOpen(false);
        toast('success', intl.formatMessage(messages.updateSuccess));
        onClose();
      })
      .catch(() => {
        setConfirmOpen(false);
        toast('error', intl.formatMessage(messages.updateError));
      });
  };

  return (
    <>
      <FormattedMessage
        id="global.acceptContributionsFrom"
        defaultMessage="Accept contributions from:"
        description="Title of the settings area that defines who can submit contributions"
        tagName="h3"
      />
      <RadioCard
        name="contribution_audience"
        selected={audience === 'all_end_users'}
        size="large"
        title={
          <FormattedMessage
            id="global.allEndUsersTitle"
            defaultMessage="All end-users"
            description="Title for the contribution audience that accepts contributions from any end-user"
          />
        }
        description={
          <FormattedMessage
            id="global.allEndUsersDescription"
            defaultMessage="Any member of your audience can use the code <strong>{contributionCode}</strong> to submit a contribution."
            description="Description for the contribution audience that accepts contributions from any end-user"
            values={{ contributionCode: hub!.contribution_code, strong }}
          />
        }
        value="all_end_users"
        onChange={() => setAudience('all_end_users')}
      />
      <RadioCard
        name="contribution_audience"
        selected={audience === 'trusted_end_users'}
        size="large"
        title={
          <FormattedMessage
            id="global.endUserAllowlistTitle"
            defaultMessage="End-user allowlist"
            description="Title for the contribution audience that only accepts contributions from trusted end-users"
          />
        }
        description={
          <FormattedMessage
            id="global.endUserAllowlistDescription"
            defaultMessage="Only the trusted end-users listed below can submit a contribution."
            description="Description for the contribution audience that only accepts contributions from trusted end-users"
          />
        }
        value="trusted_end_users"
        onChange={() => setAudience('trusted_end_users')}
      />
      <div className={styles.customizeActions}>
        <Button
          disabled={!hasChanges}
          label={
            <FormattedMessage
              id="global.updateWorkflow"
              defaultMessage="Update workflow"
              description="Button label to update the contribution workflow mode"
            />
          }
          size="small"
          variant="filled"
          onClick={() => setConfirmOpen(true)}
        />
        <Button
          label={
            <FormattedMessage
              id="global.cancel"
              defaultMessage="Cancel"
              description="Reusable label for cancel buttons"
            />
          }
          size="small"
          variant="text"
          themeMode
          onClick={onClose}
        />
      </div>
      {audience === 'trusted_end_users' && <TrustedEndUsersSettings />}
      <ConfirmContributionAudienceModal
        audience={audience}
        mode={hub!.contribution_workflow_mode}
        contributionCode={hub!.contribution_code}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
};

export default ContributionAudienceSettings;
