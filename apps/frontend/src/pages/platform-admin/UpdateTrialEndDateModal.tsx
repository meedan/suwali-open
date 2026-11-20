import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { toDateInputValue } from '@helpers/platform-admin';

import { updateAdminHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import { Modal } from '@ui-components/layout/Modal';

import styles from './HubDetails.module.css';

type Props = {
  hubId: number;
  currentTrialEndsAt: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.updateTrialEndDateModal.success',
    defaultMessage: 'Trial end date updated.',
    description: 'Toast shown when the trial end date is successfully updated',
  },
  error: {
    id: 'admin.updateTrialEndDateModal.error',
    defaultMessage: 'Failed to update trial end date. Please try again.',
    description: 'Toast shown when updating the trial end date fails',
  },
});

const UpdateTrialEndDateModal = ({ hubId, currentTrialEndsAt, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(currentTrialEndsAt ? toDateInputValue(currentTrialEndsAt) : '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(currentTrialEndsAt ? toDateInputValue(currentTrialEndsAt) : '');
    }
  }, [open, currentTrialEndsAt]);

  const initialDate = currentTrialEndsAt ? toDateInputValue(currentTrialEndsAt) : '';

  const handleSubmit = async () => {
    if (submitting || !date || date === initialDate) return;
    setSubmitting(true);

    try {
      await updateAdminHub(hubId, { trial_ends_at: date });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs', String(hubId)] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const Body = (
    <div className={styles.modalBody}>
      <TextInput
        id="trial-end-date"
        type="date"
        label={
          <FormattedMessage
            id="admin.updateTrialEndDateModal.fieldLabel"
            defaultMessage="Trial end date"
            description="Label for the trial end date input in the update modal"
          />
        }
        value={date}
        onChange={(e) => setDate(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
        autoFocus // eslint-disable-line jsx-a11y/no-autofocus
        disabled={submitting}
        required
        size="large"
      />
    </div>
  );

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
        disabled={submitting || !date || date === initialDate}
        label={
          <FormattedMessage
            id="admin.updateEndDateConfirm"
            defaultMessage="Yes, update end date"
            description="Confirm button label for the update trial end date modal"
          />
        }
        size="small"
        variant="filled"
        onClick={handleSubmit}
      />
    </>
  );

  return (
    <Modal
      actions={Actions}
      body={Body}
      description={
        <FormattedMessage
          id="admin.updateTrialEndDateModal.description"
          defaultMessage="Update the trial end date for this hub."
          description="Accessible description for the update trial end date modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.updateTrialEndDateModal.title"
          defaultMessage="Update trial end date?"
          description="Title of the modal for updating a hub trial end date"
        />
      }
    />
  );
};

export default UpdateTrialEndDateModal;
