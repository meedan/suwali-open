import { FormattedMessage } from 'react-intl';

import type { Hub } from '@customTypes/hub';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmContributionReviewProcessModalProps = {
  mode: Hub['contribution_workflow_mode'];
  audience: Hub['contribution_audience'];
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const strong = (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>;

const ConfirmContributionReviewProcessModal = ({
  mode,
  audience,
  open,
  onCancel,
  onConfirm,
}: ConfirmContributionReviewProcessModalProps) => (
  <Modal
    alert
    open={open}
    size="small"
    title={
      <FormattedMessage
        id="global.confirmContributionReviewProcessTitle"
        defaultMessage="Change review process?"
        description="Confirmation dialog title before changing what happens to contributions when they arrive"
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
              id="global.updateProcess"
              defaultMessage="Update process"
              description="Button label to update the contribution review process"
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
        {mode === 'direct' ? (
          <FormattedMessage
            id="global.confirmContributionReviewProcessDirectBody"
            defaultMessage="By setting the review process to <strong>Direct</strong>, all community contributions will be <strong>immediately</strong> available to the chatbot to respond to your audience."
            description="Confirmation dialog message before setting the review process to direct"
            tagName="p"
            values={{ strong }}
          />
        ) : (
          <FormattedMessage
            id="global.confirmContributionReviewProcessReviewBody"
            defaultMessage="By setting the review process to <strong>Review</strong>, community contributions will be <strong>paused</strong>. Your chatbot will only use them to respond to your audience when they are reviewed and <strong>activated</strong>."
            description="Confirmation dialog message before setting the review process to review"
            tagName="p"
            values={{ strong }}
          />
        )}
        {audience === 'all_end_users' ? (
          <FormattedMessage
            id="global.confirmContributionReviewProcessAllEndUsersDetails"
            defaultMessage="<strong>Any end-user</strong> from your audience can submit a community contribution."
            description="Details shown in the confirmation dialog when any end-user can contribute"
            tagName="p"
            values={{ strong }}
          />
        ) : (
          <FormattedMessage
            id="global.confirmContributionReviewProcessAllowlistDetails"
            defaultMessage="Only end-users in your <strong>allowlist</strong> can submit community contributions."
            description="Details shown in the confirmation dialog when only trusted end-users can contribute"
            tagName="p"
            values={{ strong }}
          />
        )}
      </>
    }
  />
);

export default ConfirmContributionReviewProcessModal;
