import { useQuery } from '@tanstack/react-query';

import { fetchExternalResources } from '@services/ExternalResourcesService';
import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

// The hub and the external resources that personalization is made of. The hub shown first is the one the
// session already has, so the page does not wait on the request to draw.
export const usePersonalizationHub = () => {
  const session = useSession();
  const hubId = session.currentHubId();

  const { data } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
  });

  const { data: resources, isPending: resourcesPending, isSuccess: resourcesLoaded } = useQuery({
    queryKey: [`/hubs/${hubId}/external-resources`],
    queryFn: () => fetchExternalResources(hubId!),
    enabled: Boolean(hubId),
  });

  return { hub: data || session.currentHub(), resources: resources || [], resourcesLoaded, resourcesPending };
};
