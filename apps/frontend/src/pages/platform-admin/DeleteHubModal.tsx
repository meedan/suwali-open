import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { deleteAdminHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type Props = {
  hubId: number;
  hubName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.deleteHubSuccess',
    defaultMessage: 'Hub deletion scheduled. It may take a few minutes to complete.',
    description: 'Toast shown when a hub deletion is successfully scheduled',
  },
  error: {
    id: 'admin.deleteHubError',
    defaultMessage: 'Failed to delete hub. Please try again.',
    description: 'Toast shown when scheduling a hub deletion fails',
  },
});

const DeleteHubModal = ({ hubId, hubName, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      await deleteAdminHub(hubId);
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs'] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
      navigate('/platform-admin');
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
          <FormattedMessage
            id="admin.deleteHubModal.confirm"
            defaultMessage="Yes, delete hub"
            description="Label on the confirm button to delete a hub"
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
            id="admin.deleteHubModal.body"
            defaultMessage="This will permanently delete the hub and all of its data. Deletion runs in the background and may take a few minutes to complete."
            description="Confirmation message body for deleting a hub"
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
          id="admin.deleteHubModal.description"
          defaultMessage="Permanently delete a hub and all of its data. A process that cannot be undone."
          description="Accessible description for the delete hub modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.deleteHubModal.title"
          defaultMessage="Delete hub?"
          description="Title of the modal for deleting a hub"
        />
      }
      titleContext={
        <>
          <Icon id="organization" aria-hidden />
          <strong>{hubName}</strong>
        </>
      }
    />
  );
};

export default DeleteHubModal;
