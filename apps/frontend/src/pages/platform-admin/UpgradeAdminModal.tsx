import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { upgradeToWriteAdmin } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type Props = {
  user: { id: number; email: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.upgradeAdminModal.success',
    defaultMessage: 'User upgraded to write platform admin successfully.',
    description: 'Message shown when a user is successfully upgraded to write platform admin',
  },
  error: {
    id: 'admin.upgradeAdminModal.error',
    defaultMessage: 'Failed to upgrade user. Please try again.',
    description: 'Toast shown when upgrading a user to write platform admin fails',
  },
});

const UpgradeAdminModal = ({ user, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const handleUpgrade = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      await upgradeToWriteAdmin(user!.id);
      await queryClient.invalidateQueries({ queryKey: ['/admin/users/super-admins'] });
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
                id="global.upgrading"
                defaultMessage="Upgrading…"
                description="Reusable status label for an active upgrade process"
              />
            : <FormattedMessage
                id="admin.upgradeAdminModal.confirm"
                defaultMessage="Yes, upgrade to write admin"
                description="Label on the confirm button to upgrade a user to write platform admin"
              />
        }
        size="small"
        variant="filled"
        onClick={() => { void handleUpgrade(); }}
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
            id="admin.upgradeAdminModal.body"
            defaultMessage="This will grant full write access to the platform admin area, including the ability to modify hubs, delete users, and upgrade other admins."
            description="Confirmation message body for upgrading a user to write platform admin"
            tagName="p"
          />
          <FormattedMessage
            id="global.cannotBeUndoneAreYouSure"
            defaultMessage="This action <strong>cannot be undone</strong>. Are you sure?"
            description="Reusable confirmation dialog message before deleting something"
            tagName="p"
            values={{
              s: msg => (<strong key="strong">{msg}</strong>),
            }}
          />
        </>
      }
      description={
        <FormattedMessage
          id="admin.upgradeAdminModal.description"
          defaultMessage="Grant write platform admin access to a read-only platform admin."
          description="Accessible description for the upgrade admin modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.upgradeAdminModal.title"
          defaultMessage="Upgrade to write admin?"
          description="Title of the modal for upgrading a user to write platform admin"
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

export default UpgradeAdminModal;
