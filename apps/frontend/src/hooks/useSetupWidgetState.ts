import { useQuery } from '@tanstack/react-query';

import type { MessagingIntegration } from '@customTypes/messaging-integration';

import { fetchIntegrations } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';

export type SetupWidgetState =
  | { type: 'pending' }
  | { type: 'error', error: Error }
  | { type: 'hidden' }
  | { type: 'continueSetup' }
  | { type: 'goLive'; trialExpired: boolean }
  | { type: 'integrations'; integrations: MessagingIntegration[] };

export function useSetupWidgetState(): SetupWidgetState {
  const hubId = useSession().currentHubId();
  const canUpdateHub = useCan('UPDATE_HUB').allowed;
  const messagingDecision = useCan('MANAGE_MESSAGING_INTEGRATION');
  // Preloaded content is deliberately ignored here so this state keeps asking for the hub's own content
  const { ownSourceCreated, ownDocumentSynced, isPending: setupTasksPending } = useHubSetupTasks();

  const { isPending, error, data } = useQuery({
    queryKey: [`/hubs/${hubId}/messaging-integrations`],
    queryFn: () => fetchIntegrations(hubId!),
    enabled: Boolean(hubId),
  });

  if (isPending || setupTasksPending) {
    return { type: 'pending' };
  }

  if (error) {
    return { type: 'error', error };
  }

  const integrations = data?.filter((integration: MessagingIntegration) => integration.active) ?? [];

  if (canUpdateHub && !(ownSourceCreated && ownDocumentSynced)) {
    return { type: 'continueSetup' };
  }

  if (integrations.length === 0) {
    const trialExpired = Boolean(messagingDecision.reasons?.includes('trial_expired'));

    if (!messagingDecision.allowed && !trialExpired) {
      return { type: 'hidden' };
    }

    return { type: 'goLive', trialExpired };
  }

  return { type: 'integrations', integrations };
}
