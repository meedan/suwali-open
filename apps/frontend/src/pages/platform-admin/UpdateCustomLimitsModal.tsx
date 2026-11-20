import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { type HubCustomLimits, updateAdminHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import { Modal } from '@ui-components/layout/Modal';

import styles from './HubDetails.module.css';

export type LimitField = 'sources' | 'messages' | 'documents';

const fieldConfig: Record<LimitField, { title: ReactNode; labelKey: ReactNode }> = {
  sources: {
    title: <FormattedMessage id="admin.updateCustomLimitsModal.sourcesTitle" defaultMessage="Update max data sources?" description="Title of the modal for updating the data sources custom limit" />,
    labelKey: <FormattedMessage id="admin.updateCustomLimitsModal.sourcesLabel" defaultMessage="Max data sources" description="Label for the data sources limit input" />,
  },
  messages: {
    title: <FormattedMessage id="admin.updateCustomLimitsModal.messagesTitle" defaultMessage="Update max monthly messages?" description="Title of the modal for updating the monthly messages custom limit" />,
    labelKey: <FormattedMessage id="admin.updateCustomLimitsModal.messagesLabel" defaultMessage="Max monthly messages" description="Label for the monthly messages limit input" />,
  },
  documents: {
    title: <FormattedMessage id="admin.updateCustomLimitsModal.documentsTitle" defaultMessage="Update max documents?" description="Title of the modal for updating the documents custom limit" />,
    labelKey: <FormattedMessage id="admin.updateCustomLimitsModal.documentsLabel" defaultMessage="Max documents" description="Label for the documents limit input" />,
  },
};

type Props = {
  hubId: number;
  currentLimits: HubCustomLimits | null;
  field: LimitField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messages = defineMessages({
  success: {
    id: 'admin.updateCustomLimitsModal.success',
    defaultMessage: 'Custom limit updated.',
    description: 'Toast shown when a custom limit is successfully updated',
  },
  error: {
    id: 'admin.updateCustomLimitsModal.error',
    defaultMessage: 'Failed to update custom limit. Please try again.',
    description: 'Toast shown when updating a custom limit fails',
  },
});

const UpdateCustomLimitsModal = ({ hubId, currentLimits, field, open, onOpenChange }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(currentLimits?.[field]?.toString() ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentLimits?.[field]?.toString() ?? '');
    }
  }, [open, currentLimits, field]);

  const initialValue = currentLimits?.[field]?.toString() ?? '';

  const handleSubmit = async () => {
    if (submitting || value === initialValue) return;
    setSubmitting(true);

    const updated: HubCustomLimits = { ...(currentLimits ?? {}) };
    if (value !== '') {
      updated[field] = Number(value);
    } else {
      delete updated[field];
    }

    try {
      await updateAdminHub(hubId, { custom_limits: Object.keys(updated).length > 0 ? updated : null });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs', String(hubId)] });
      toast('success', intl.formatMessage(messages.success));
      onOpenChange(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const { title, labelKey } = fieldConfig[field];

  const Body = (
    <div className={styles.modalBody}>
      <TextInput
        id={`custom-limit-${field}`}
        type="number"
        label={labelKey}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus // eslint-disable-line jsx-a11y/no-autofocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') { void handleSubmit(); return; }
          if (!/^\d$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) e.preventDefault();
        }}
        disabled={submitting}
        size="large"
        inputProps={{ min: 1 }}
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
        disabled={submitting || value === initialValue}
        label={
          <FormattedMessage
            id="admin.confirmUpdateCustomLimit"
            defaultMessage="Yes, update custom limit"
            description="Reusable label for save buttons"
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
          id="admin.updateCustomLimitsModal.description"
          defaultMessage="Set a custom limit for this hub. Leave empty to use the plan default."
          description="Accessible description for the update custom limit modal"
        />
      }
      open={open}
      onOpenChange={onOpenChange}
      size="small"
      title={title}
    />
  );
};

export default UpdateCustomLimitsModal;
