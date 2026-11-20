import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { createConversation, fetchLatestOwnConversation, sendMessage } from '@services/ConversationsService';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

const messages = defineMessages({
  newChatTitle: {
    id: 'global.untitledConversation',
    defaultMessage: 'Untitled conversation',
    description: 'Default conversation title',
  },
  submitError: {
    id: 'global.conversationSubmitError',
    defaultMessage: 'Something went wrong. Please try again.',
    description: 'Error message shown when starting a conversation fails',
  },
});

type UseStartConversationOptions = {
  onSuccess?: (conversationId: number) => Promise<void> | void;
};

export function useStartConversation({ onSuccess }: UseStartConversationOptions = {}) {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (message: string) => {
    if (!hubId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const existing = await fetchLatestOwnConversation(hubId);
      const conversationId = existing?.id
        ?? (await createConversation(hubId, intl.formatMessage(messages.newChatTitle))).id;
      await sendMessage(conversationId, message);
      await onSuccess?.(conversationId);
    } catch {
      toast('error', intl.formatMessage(messages.submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return { handleSubmit, isSubmitting };
}
