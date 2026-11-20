import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { ExternalUser } from '@customTypes/external-user';

import { getPlatformName } from '@helpers/conversation';

import { updateExternalUserTrustedStatus } from '@services/ExternalUsersService';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

const messages = defineMessages({
  updateSuccess: {
    id: 'global.updateTrustedUserStatusSuccess',
    defaultMessage: 'Trusted end-user status updated successfully.',
    description: 'Success toast after updating trusted end-user status',
  },
  updateError: {
    id: 'global.updateTrustedUserStatusError',
    defaultMessage: 'There was an error updating the trusted end-user status. Please try again.',
    description: 'Error toast when updating trusted end-user status fails',
  },
});

type ConfirmTrustedUserStatusModalProps = {
  action: 'add' | 'remove';
  open: boolean;
  user: ExternalUser;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

const ConfirmTrustedUserStatusModal = ({
  action,
  open,
  user,
  onOpenChange,
  onSuccess,
}: ConfirmTrustedUserStatusModalProps) => {
  const [isPending, setIsPending] = useState(false);
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const { toast } = useToast();

  if (!hubId) {
    return null;
  }

  const platformName = getPlatformName(user.platform);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await updateExternalUserTrustedStatus(hubId, user.id, action === 'add');
      onOpenChange(false);
      toast('success', intl.formatMessage(messages.updateSuccess));
      onSuccess?.();
    } catch {
      toast('error', intl.formatMessage(messages.updateError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Modal
        alert
        open={open}
        onOpenChange={onOpenChange}
        size="small"
        title={
          action === 'add' ? (
            <FormattedMessage
              id="global.updateTrustedUserStatusAddTitle"
              defaultMessage="Add trusted end-user status?"
              description="Confirmation dialog title before adding trusted end-user status"
            />
          ) : (
            <FormattedMessage
              id="global.updateTrustedUserStatusRemoveTitle"
              defaultMessage="Remove trusted end-user status?"
              description="Confirmation dialog title before removing trusted end-user status"
            />
          )
        }
        body={
          action === 'add' ? (
            <FormattedMessage
              id="global.updateTrustedUserStatusAddBody"
              defaultMessage="{userName} on {platformName} will become a trusted end-user and be able to send contributions in the system."
              description="Body of add trusted end-user status confirmation dialog"
              tagName="p"
              values={{
                userName: <strong key="userName">{user.name}</strong>,
                platformName: <strong key="platformName">{platformName}</strong>,
              }}
            />
          ) : (
            <FormattedMessage
              id="global.updateTrustedUserStatusRemoveBody"
              defaultMessage="{userName} on {platformName} will no longer be able to send in contributions. They will still be able to chat with your chatbot."
              description="Body of remove trusted end-user status confirmation dialog"
              tagName="p"
              values={{
                userName: <strong key="userName">{user.name}</strong>,
                platformName: <strong key="platformName">{platformName}</strong>,
              }}
            />
          )
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
              onClick={() => onOpenChange(false)}
            />
            <Button
              label={
                action === 'add' ? (
                  <FormattedMessage
                    id="global.updateTrustedUserStatusAddConfirm"
                    defaultMessage="Yes, add trusted status"
                    description="Confirm button label to add trusted end-user status"
                  />
                ) : (
                  <FormattedMessage
                    id="global.updateTrustedUserStatusRemoveConfirm"
                    defaultMessage="Yes, remove trusted status"
                    description="Confirm button label to remove trusted end-user status"
                  />
                )
              }
              size="small"
              disabled={isPending}
              onClick={handleConfirm}
            />
          </>
        }
      />
    </>
  );
};

export default ConfirmTrustedUserStatusModal;
