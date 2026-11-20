import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from "@tanstack/react-query";

import type { Hub } from '@customTypes/hub';

import { updateContributionWorkflowMode } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import RadioCard from '@ui-components/layout/RadioCard';

import ConfirmContributionReviewProcessModal from './ConfirmContributionReviewProcessModal';
import styles from './DataSourcesContributionsSettings.module.css';

const messages = defineMessages({
  updateSuccess: {
    id: 'global.contributionWorkflowUpdateSuccess',
    defaultMessage: 'Contribution workflow updated to {mode}.',
    description: 'Toast message shown when the contribution workflow mode is updated successfully',
  },
  updateError: {
    id: 'global.contributionWorkflowUpdateError',
    defaultMessage: 'Failed to update contribution workflow.',
    description: 'Toast message shown when the contribution workflow mode update fails',
  },
  direct: {
    id: 'global.directTitle',
    defaultMessage: 'Direct',
    description: 'Title for the direct contribution workflow mode',
  },
  review: {
    id: 'global.reviewTitle',
    defaultMessage: 'Review',
    description: 'Title for the review contribution workflow mode',
  },
});

const strong = (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>;

type ContributionReviewProcessSettingsProps = {
  onClose: () => void;
};

const ContributionReviewProcessSettings = ({ onClose }: ContributionReviewProcessSettingsProps) => {
  const intl = useIntl();
  const session = useSession();
  const hub = session.currentHub();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedMode = hub!.contribution_workflow_mode;
  const [mode, setMode] = useState<Hub['contribution_workflow_mode']>(savedMode);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasChanges = mode !== savedMode;

  const handleConfirm = () => {
    updateContributionWorkflowMode(hub!.id, mode)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hub!.id}`] });
        setConfirmOpen(false);
        toast('success', intl.formatMessage(messages.updateSuccess, { mode: intl.formatMessage(messages[mode]) }));
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
        id="global.contributionReviewProcess"
        defaultMessage="Contribution review process"
        description="Title of the settings area that defines what happens to contributions when they arrive"
        tagName="h3"
      />
      <RadioCard
        name="contribution_workflow_mode"
        selected={mode === 'direct'}
        size="large"
        title={
          <FormattedMessage
            id="global.directTitle"
            defaultMessage="Direct"
            description="Title for the direct contribution workflow mode"
          />
        }
        description={
          <FormattedMessage
            id="global.directDescription"
            defaultMessage="Trusted end-user contributions are <strong>immediately</strong> available to the chatbot to use in responses to other end-users."
            description="Description for the direct contribution workflow mode"
            values={{ strong }}
          />
        }
        value="direct"
        onChange={() => setMode('direct')}
      />
      <RadioCard
        name="contribution_workflow_mode"
        selected={mode === 'review'}
        size="large"
        title={
          <FormattedMessage
            id="global.reviewTitle"
            defaultMessage="Review"
            description="Title for the review contribution workflow mode"
          />
        }
        description={
          <FormattedMessage
            id="global.reviewDescription"
            defaultMessage="Trusted end-user contributions are added to the system as <strong>paused</strong>. You can choose to make them available to your chatbot to respond to other end-users."
            description="Description for the review contribution workflow mode"
            values={{ strong }}
          />
        }
        value="review"
        onChange={() => setMode('review')}
      />
      <div className={styles.customizeActions}>
        <Button
          disabled={!hasChanges}
          label={
            <FormattedMessage
              id="global.updateProcess"
              defaultMessage="Update process"
              description="Button label to update the contribution review process"
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
      <ConfirmContributionReviewProcessModal
        mode={mode}
        audience={hub!.contribution_audience}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
};

export default ContributionReviewProcessSettings;
