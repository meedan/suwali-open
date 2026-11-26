import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { hubPath } from '@helpers/hubPath';
import { allPlans, formatPlanLabel } from '@helpers/plan';

import { createAdminHub } from '@services/AdminService';

import { HttpError, sanitizeApiErrors } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import TextInput from '@ui-components/input/TextInput';
import HintBox from '@ui-components/layout/HintBox';
import { Modal } from '@ui-components/layout/Modal';

import styles from './HubDetails.module.css';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DEFAULT_PLAN = 'free';

const messages = defineMessages({
  success: {
    id: 'admin.createHubModal.success',
    defaultMessage: 'Hub created.',
    description: 'Toast shown when a platform admin creates a hub',
  },
  error: {
    id: 'admin.createHubModal.error',
    defaultMessage: 'We couldn’t create the hub. Please try again.',
    description: 'Toast shown when creating a hub from the platform admin dashboard fails',
  },
});

const CreateHubModal = ({ open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPlan(DEFAULT_PLAN);
      setIsSubmitted(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (submitting) return;
    setIsSubmitted(true);
    if (!name.trim()) return;
    setSubmitting(true);

    try {
      const hub = await createAdminHub({ name: name.trim(), plan });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs'] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
      await session.setCurrentHubId(hub.id);
      navigate(hubPath('/dashboard', hub.id));
    } catch (error) {
      const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
      toast('error', message || intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const Body = (
    <div className={styles.modalBody}>
      <TextInput
        id="create-hub-name"
        label={
          <FormattedMessage
            id="admin.createHubModal.nameLabel"
            defaultMessage="Hub name"
            description="Label for the hub name input in the platform admin create hub modal"
          />
        }
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
        error={
          !name.trim() && isSubmitted && (
            <FormattedMessage
              id="admin.createHubModal.nameError"
              defaultMessage="Enter a name for the hub."
              description="Error shown when a platform admin tries to create a hub without a name"
            />
          )
        }
        autoFocus // eslint-disable-line jsx-a11y/no-autofocus
        disabled={submitting}
        required
        size="large"
      />
      <Select
        label={
          <FormattedMessage
            id="admin.updatePlanModal.planLabel"
            defaultMessage="Plan"
            description="Label for the plan selector input"
          />
        }
        value={plan}
        onValueChange={setPlan}
        disabled={submitting}
        size="large"
      >
        {allPlans.map((value) => (
          <SelectItem key={value} value={value}>
            {formatPlanLabel(intl, value)}
          </SelectItem>
        ))}
      </Select>
      {plan === 'free' && (
        <HintBox
          type="info"
          body={
            <FormattedMessage
              id="admin.createHubModal.trialEmailsHelp"
              defaultMessage="Trial emails are turned off for this hub. You can turn them on from the hub’s page in the platform admin."
              description="Hint box in the create hub dialog, shown when the free trial plan is selected. “Trial emails” are the automatic emails sent to a hub’s admins during its free trial."
              tagName="p"
            />
          }
        />
      )}
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
        disabled={submitting}
        label={
          <FormattedMessage
            id="admin.createHub"
            defaultMessage="Create hub"
            description="Button label for the action of creating a new hub. In English, “create” is a verb and “hub” its object; it is not a noun phrase such as “hub creation”."
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
          id="admin.createHubModal.description"
          defaultMessage="Create a hub without joining it. You’ll be taken to the new hub."
          description="Accessible description for the platform admin create hub modal"
        />
      }
      open={open}
      onOpenChange={submitting ? undefined : onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.createHubModal.title"
          defaultMessage="Create hub"
          description="Dialog title for creating a new hub. In English, “create” is a verb and “hub” its object; it is not a noun phrase such as “hub creation”."
        />
      }
    />
  );
};

export default CreateHubModal;
