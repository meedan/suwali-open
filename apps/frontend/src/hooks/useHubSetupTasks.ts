import { useQuery } from '@tanstack/react-query';

import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

export type HubOnboardingTasks = {
  sourceCreated: boolean;
  documentSynced: boolean;
  internalConversationMessageReceived: boolean;
  messagingPlatformConnected: boolean;
  ownSourceCreated: boolean;
  ownDocumentSynced: boolean;
};

export function useHubSetupTasks({ poll = false }: { poll?: boolean } = {}) {
  const hubId = useSession().currentHubId();

  const { data: hubData, isPending: queryIsPending } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
    refetchInterval: poll
      ? (query) => {
          const t = query.state.data?.onboarding_tasks;
          // Only the hub's own content is waited for, since the surfaces that poll are the onboarding
          // ones. Not conditioned on own_source_created: creating a source invalidates the sources
          // query and not this one, so it can still read false right after the user adds a source,
          // and polling would stop before ever noticing it.
          return t?.own_document_synced ? false : 3000;
        }
      : false,
  });

  const isPending = Boolean(hubId) && queryIsPending;

  const tasks: HubOnboardingTasks = {
    sourceCreated: hubData?.onboarding_tasks?.source_created ?? false,
    documentSynced: hubData?.onboarding_tasks?.document_synced ?? false,
    internalConversationMessageReceived: hubData?.onboarding_tasks?.internal_conversation_message_received ?? false,
    messagingPlatformConnected: hubData?.onboarding_tasks?.messaging_platform_connected ?? false,
    ownSourceCreated: hubData?.onboarding_tasks?.own_source_created ?? false,
    ownDocumentSynced: hubData?.onboarding_tasks?.own_document_synced ?? false,
  };

  return { ...tasks, isPending };
}
