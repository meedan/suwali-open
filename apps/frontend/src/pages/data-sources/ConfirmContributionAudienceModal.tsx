import { FormattedMessage } from 'react-intl';

import type { Hub } from '@customTypes/hub';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmContributionAudienceModalProps = {
  audience: Hub['contribution_audience'];
  mode: Hub['contribution_workflow_mode'];
  contributionCode: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const strong = (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>;

const ConfirmContributionAudienceModal = ({
  audience,
  mode,
  contributionCode,
  open,
  onCancel,
  onConfirm,
}: ConfirmContributionAudienceModalProps) => (
  <Modal
    alert
    open={open}
    size="small"
    title={
      <FormattedMessage
        id="global.confirmContributionAudienceTitle"
        defaultMessage="Change audience requirement?"
        description="Confirmation dialog title before changing who can submit contributions"
      />
    }
    actions={
      <>
        <Button
          label={
            <FormattedMessage
              id="global.cancel"
              defaultMessage="Cancel"
              description="Reusable label for cancel buttons"
            />
          }
          size="small"
          themeMode
          variant="text"
          onClick={onCancel}
        />
        <Button
          label={
            <FormattedMessage
              id="global.updateWorkflow"
              defaultMessage="Update workflow"
              description="Button label to update the contribution workflow mode"
            />
          }
          size="small"
          variant="filled"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        {audience === 'all_end_users' ? (
          <FormattedMessage
            id="global.confirmContributionAudienceAllEndUsersBody"
            defaultMessage="Any end-user who messages your chatbot with the code <strong>{contributionCode}</strong> will be able to submit a community contribution."
            description="Confirmation dialog message before allowing any end-user to contribute"
            tagName="p"
            values={{ contributionCode, strong }}
          />
        ) : (
          <FormattedMessage
            id="global.confirmContributionAudienceAllowlistBody"
            defaultMessage="Only end-users in your allowlist will be able to send the code <strong>{contributionCode}</strong> and submit a community contribution."
            description="Confirmation dialog message before restricting contributions to trusted end-users"
            tagName="p"
            values={{ contributionCode, strong }}
          />
        )}
        {mode === 'direct' ? (
          <FormattedMessage
            id="global.confirmContributionAudienceDirectDetails"
            defaultMessage="Their contribution will be added <strong>directly</strong> to your data sources."
            description="Details shown in the confirmation dialog when contributions are published immediately"
            tagName="p"
            values={{ strong }}
          />
        ) : (
          <FormattedMessage
            id="global.confirmContributionAudienceReviewDetails"
            defaultMessage="Their contribution will be added as <strong>paused</strong> to your data sources."
            description="Details shown in the confirmation dialog when contributions are paused for review"
            tagName="p"
            values={{ strong }}
          />
        )}
      </>
    }
  />
);

export default ConfirmContributionAudienceModal;
