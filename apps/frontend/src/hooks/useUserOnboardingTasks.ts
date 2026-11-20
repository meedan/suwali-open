import { useQuery } from '@tanstack/react-query';

import type { Hub } from '@customTypes/hub';
import type { User } from '@customTypes/user';

import { fetchMe } from '@services/ProfileService';

import { useSession } from '@root/SessionContext';

export function useUserOnboardingTasks() {
  const hubId = useSession().currentHubId();

  const { data, isPending: queryIsPending } = useQuery({
    queryKey: ['/me'],
    queryFn: () => fetchMe(),
    enabled: Boolean(hubId),
  });

  // A disabled query never leaves the pending state, so only report pending while it can actually load
  const isPending = Boolean(hubId) && queryIsPending;

  const user = data as User;
  const hub = user?.hubs?.find((h: Hub) => h.id === hubId);
  const membershipTasks = hub?.hub_membership?.onboarding_tasks;
  const internalConversationStarted = membershipTasks?.internal_conversation_started ?? false;

  return {
    internalConversationStarted,
    isPending,
  };
}
