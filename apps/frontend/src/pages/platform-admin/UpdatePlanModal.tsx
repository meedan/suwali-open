import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { updateAdminHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import { Modal } from '@ui-components/layout/Modal';

import styles from './HubDetails.module.css';

const PLAN_LABELS: Record<string, string> = {
  free: 'Trial (free)',
  free_unrestricted: 'Trial (free, unrestricted)',
  subsidized: 'Subsidized',
  standard: 'Standard',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const PLANS = Object.keys(PLAN_LABELS);

type Props = {
  hubId: number;
  currentPlan: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.updatePlanModal.success',
    defaultMessage: 'Plan updated.',
    description: 'Toast shown when a hub plan is successfully updated',
  },
  error: {
    id: 'admin.updatePlanModal.error',
    defaultMessage: 'Failed to update plan. Please try again.',
    description: 'Toast shown when updating a hub plan fails',
  },
});

const UpdatePlanModal = ({ hubId, currentPlan, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState(currentPlan);
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedPlan(currentPlan);
      setStep('select');
    }
  }, [open, currentPlan]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await updateAdminHub(hubId, { plan: selectedPlan });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs', String(hubId)] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const fromLabel = PLAN_LABELS[currentPlan] ?? currentPlan;
  const toLabel = step === 'confirm' ? (PLAN_LABELS[selectedPlan] ?? selectedPlan) : null;

  const SelectBody = (
    <div className={styles.modalBody}>
      <Select
        label={
          <FormattedMessage
            id="admin.updatePlanModal.planLabel"
            defaultMessage="Plan"
            description="Label for the plan selector input"
          />
        }
        value={selectedPlan}
        onValueChange={setSelectedPlan}
        size="large"
      >
        {PLANS.map((plan) => (
          <SelectItem key={plan} value={plan}>
            {PLAN_LABELS[plan]}
          </SelectItem>
        ))}
      </Select>
    </div>
  );

  const ConfirmBody = (
    <div className={styles.modalBody}>
      <FormattedMessage
        id="admin.updatePlanModal.confirmMessage"
        defaultMessage="You are changing the plan from <strong>{from}</strong> to <strong>{to}</strong>."
        description="Summary shown on the confirmation step of the update plan modal"
        values={{
          from: fromLabel,
          to: toLabel ?? '',
          strong: (chunks) => <strong key="strong">{chunks}</strong>,
        }}
        tagName="p"
      />
      <FormattedMessage
        id="admin.updatePlanModal.confirmMessageAffect"
        defaultMessage="This will affect the hub’s limits and available features."
        description="Summary shown on the confirmation step of the update plan modal to communicate what the changes will affect"
        tagName="p"
      />
    </div>
  );

  const SelectActions = (
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
        disabled={selectedPlan === currentPlan}
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
            id="admin.updatePlanModal.confirm"
            defaultMessage="Yes, change plan"
            description="Label for the confirm button in the update plan modal"
          />
        }
        size="small"
        variant="filled"
        onClick={handleConfirm}
      />
    </>
  );

  return (
    <Modal
      actions={step === 'select' ? SelectActions : ConfirmActions}
      body={step === 'select' ? SelectBody : ConfirmBody}
      description={
        step === 'select' ?
          <FormattedMessage
            id="admin.updatePlanModal.selectDescription"
            defaultMessage="Select a new plan for this hub."
            description="Accessible description for the plan selection step"
          />
        :
        <FormattedMessage
          id="admin.updatePlanModal.confirmDescription"
          defaultMessage="Review your plan change before confirming."
          description="Accessible description for the plan confirmation step"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={
        <FormattedMessage
          id="admin.updatePlanModal.title"
          defaultMessage="Update plan?"
          description="Title of the modal for updating a hub plan"
        />
      }
    />
  );
};

export default UpdatePlanModal;
