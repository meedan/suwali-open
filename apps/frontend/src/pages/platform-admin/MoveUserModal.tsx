import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAdminHubs, moveUserToHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

import HubSelect from './HubSelect';

type Props = {
  user: { id: number; email: string } | null;
  sourceHub: { id: number; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.moveUserModal.success',
    defaultMessage: 'User moved.',
    description: 'Toast shown when a user is successfully moved to another hub',
  },
  error: {
    id: 'admin.moveUserModal.error',
    defaultMessage: 'Failed to move user. Please try again.',
    description: 'Toast shown when moving a user to another hub fails',
  },
});

const MoveUserModal = ({ user, sourceHub, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetHubId, setTargetHubId] = useState('');
  const [approved, setApproved] = useState(false);
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [submitting, setSubmitting] = useState(false);

  const { data: hubs = [], isPending } = useQuery({
    queryKey: ['/admin/hubs'],
    queryFn: fetchAdminHubs,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setTargetHubId('');
      setApproved(false);
      setStep('select');
    }
  }, [open]);

  const targetHub = hubs.find(hub => String(hub.id) === targetHubId);
  const targetHubs = hubs
    .filter(hub => hub.id !== sourceHub.id && !hub.deletion_requested_at)
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleConfirm = async () => {
    if (submitting || !user || !targetHub) return;
    setSubmitting(true);
    try {
      await moveUserToHub(user.id, targetHub.id, approved);
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs'] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const SelectBody = (
    <>
      <FormattedMessage
        id="admin.moveUserModal.selectBody"
        defaultMessage="Move this user into an existing hub as an editor. Their current hub and its content stay where they are."
        description="Explanation shown on the first step of the move user modal"
        tagName="p"
      />
      <HubSelect
        disabled={isPending}
        hubs={targetHubs}
        label={
          <FormattedMessage
            id="admin.moveUserModal.hubLabel"
            defaultMessage="Target hub"
            description="Label for the hub selector in the move user modal"
          />
        }
        onPick={setTargetHubId}
        value={targetHubId}
      />
    </>
  );

  const ConfirmBody = (
    <>
      <FormattedMessage
        id="admin.moveUserModal.confirmMessage"
        defaultMessage="You are moving <strong>{email}</strong> from <strong>{from}</strong> to <strong>{to}</strong>."
        description="Summary shown on the confirmation step of the move user modal"
        values={{
          email: user?.email ?? '',
          from: sourceHub.name,
          to: targetHub?.name ?? '',
          strong: chunks => <strong key="strong">{chunks}</strong>,
        }}
        tagName="p"
      />
      <Checkbox
        id="move-user-approved"
        checked={approved}
        label={
          <FormattedMessage
            id="admin.moveUserModal.approveLabel"
            defaultMessage="Approve now"
            description="Checkbox label in the move user modal to skip approval by the target hub’s admins"
          />
        }
        helpContent={
          <FormattedMessage
            id="admin.moveUserModal.approveHelp"
            defaultMessage="Leave unchecked to let the hub’s admins approve the request. Only check this if they already asked for it."
            description="Help text under the approve now checkbox in the move user modal"
          />
        }
        value="approved"
        onChange={e => setApproved(e.target.checked)}
      />
    </>
  );

  const SelectActions = (
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
        onClick={() => onOpenChange(false)}
      />
      <Button
        disabled={!targetHub}
        label={
          <FormattedMessage
            id="global.next"
            defaultMessage="Next"
            description="Generic button or label text for navigating forwards"
          />
        }
        size="small"
        variant="filled"
        onClick={() => setStep('confirm')}
      />
    </>
  );

  const ConfirmActions = (
    <>
      <Button
        disabled={submitting}
        label={
          <FormattedMessage
            id="global.back"
            defaultMessage="Back"
            description="Button label for going back to the previous step in a wizard"
          />
        }
        size="small"
        themeMode
        variant="text"
        onClick={() => setStep('select')}
      />
      <Button
        disabled={submitting}
        label={
          <FormattedMessage
            id="admin.moveUserModal.confirm"
            defaultMessage="Yes, move user"
            description="Label on the confirm button to move a user to another hub"
          />
        }
        size="small"
        variant="filled"
        onClick={() => { void handleConfirm(); }}
      />
    </>
  );

  return (
    <Modal
      alert
      actions={step === 'select' ? SelectActions : ConfirmActions}
      body={step === 'select' ? SelectBody : ConfirmBody}
      description={
        <FormattedMessage
          id="admin.moveUserModal.description"
          defaultMessage="Move a user who created their own hub by mistake into an existing hub."
          description="Accessible description for the move user modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.moveUserModal.title"
          defaultMessage="Move user to another hub?"
          description="Title of the modal for moving a user to another hub"
        />
      }
      titleContext={
        <>
          <Icon id="user" aria-hidden />
          <strong>{user?.email}</strong>
        </>
      }
    />
  );
};

export default MoveUserModal;
