import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { type HubCustomLimits, updateAdminHub } from '@services/AdminService';

import { useToast } from '@hooks/useToast';

import Checkbox from '@ui-components/input/Checkbox';

type Props = {
  hubId: number;
  currentLimits: HubCustomLimits | null;
};

const messages = defineMessages({
  label: {
    id: 'admin.smsAccessToggle.label',
    defaultMessage: 'SMS enabled',
    description: 'Label for the toggle that enables SMS for a hub',
  },
  success: {
    id: 'admin.smsAccessToggle.success',
    defaultMessage: 'SMS access updated.',
    description: 'Toast shown when a hub SMS access is successfully updated',
  },
  error: {
    id: 'admin.smsAccessToggle.error',
    defaultMessage: 'Failed to update SMS access. Please try again.',
    description: 'Toast shown when updating a hub SMS access fails',
  },
});

// SMS is a per-hub plan capability stored in custom_limits.sms. The backend replaces the whole
// custom_limits object on update, so we always send the merged object with only the sms key changed.
const SmsAccessToggle = ({ hubId, currentLimits }: Props) => {
  const intl = useIntl();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const enabled = currentLimits?.sms === true;

  const handleChange = async () => {
    if (submitting) return;
    setSubmitting(true);

    const updated: HubCustomLimits = { ...(currentLimits ?? {}) };
    if (enabled) {
      delete updated.sms;
    } else {
      updated.sms = true;
    }

    try {
      await updateAdminHub(hubId, { custom_limits: Object.keys(updated).length > 0 ? updated : null });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs', String(hubId)] });
      toast('success', intl.formatMessage(messages.success));
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Checkbox
      id={`sms-access-${hubId}`}
      label={intl.formatMessage(messages.label)}
      value="sms"
      checked={enabled}
      disabled={submitting}
      onChange={handleChange}
    />
  );
};

export default SmsAccessToggle;
