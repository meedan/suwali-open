import { defineMessages, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

const messages = defineMessages({
  successTitle: {
    id: 'personalizationPanel.successTitle',
    defaultMessage: 'Personalization saved successfully',
    description: 'Title for success toast when attributes or resources are updated',
  },
  errorTitle: {
    id: 'personalizationPanel.errorTitle',
    defaultMessage: 'Error saving personalization',
    description: 'Title for error toast when saving attributes or resource fail',
  },
  successMessage: {
    id: 'personalizationPanel.successMessage',
    defaultMessage: 'The personalization settings have been successfully saved.',
    description: 'Message for success toast when attributes or resources are saved',
  },
  errorMessage: {
    id: 'personalizationPanel.errorMessage',
    defaultMessage: 'An error occurred while saving personalization settings.',
    description: 'Message for error toast when saving attributes or resource fail',
  },
});

// What every personalization form does once it has saved or failed to: tells the person, and on a save
// refreshes what the hub and its resources show. `afterSaved` is for whatever the caller closes or resets.
export const usePersonalizationSaved = (afterSaved?: () => void) => {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const hubId = useSession().currentHubId();
  const { toast } = useToast();

  const onSaved = () => {
    toast('success', intl.formatMessage(messages.successMessage), intl.formatMessage(messages.successTitle));
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}`] });
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/external-resources`] });
    afterSaved?.();
  };

  const onSaveError = () => {
    toast('error', intl.formatMessage(messages.errorMessage), intl.formatMessage(messages.errorTitle));
  };

  return { onSaved, onSaveError };
};
