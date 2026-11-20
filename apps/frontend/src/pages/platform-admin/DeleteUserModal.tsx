import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { deleteUser } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Icon from "@ui-components/layout/Icon";
import { Modal } from '@ui-components/layout/Modal';

type Props = {
  user: { id: number; email: string } | null;
  invalidateQueryKey: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.deleteUserModalSuccess',
    defaultMessage: 'User deleted successfully.',
    description: 'Message shown when a user is successfully deleted',
  },
  error: {
    id: 'admin.deleteUserModal.error',
    defaultMessage: 'Failed to delete user. Please try again.',
    description: 'Toast shown when deleting a user fails',
  },
});

const DeleteUserModal = ({ user, invalidateQueryKey, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      await deleteUser(user!.id);
      await queryClient.invalidateQueries({ queryKey: invalidateQueryKey });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const Actions = (
    <>
      <Button
        disabled={submitting}
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
        disabled={submitting}
        label={
          submitting
            ? <FormattedMessage
                id="global.deleting"
                defaultMessage="Deleting…"
                description="Reusable status label for an active delete process"
              />
            : <FormattedMessage
                id="admin.deleteUserModal.confirm"
                defaultMessage="Yes, delete user"
                description="Label on the confirm button to delete a user"
              />
        }
        size="small"
        variant="filled"
        onClick={() => { void handleDelete(); }}
      />
    </>
  );

  return (
    <Modal
      alert
      actions={Actions}
      body={
        <>
          <FormattedMessage
            id="admin.deleteUserModal.body"
            defaultMessage="This will permanently delete the account. The user would need to register again."
            description="Confirmation message body for deleting a user"
            tagName="p"
          />
          <FormattedMessage
            id="global.cannotBeUndoneAreYouSure"
            defaultMessage="This action <strong>cannot be undone</strong>. Are you sure?"
            description="Reusable confirmation dialog message before deleting something"
            tagName="p"
            values={{
              strong: msg => (<strong key="strong">{msg}</strong>),
            }}
          />
        </>
      }
      description={
        <FormattedMessage
          id="admin.deleteUserModal.description"
          defaultMessage="Permanently delete a user account. A process that cannot be undone."
          description="Accessible description for the delete user modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.deleteUserModal.title"
          defaultMessage="Delete user?"
          description="Title of the modal for deleting a user"
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

export default DeleteUserModal;
