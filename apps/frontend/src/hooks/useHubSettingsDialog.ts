import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';

import type { settingsTabs } from '@pages/hub-settings/HubSettings';

export const useHubSettingsDialog = () => {
  const session = useSession();
  const hubId = session.currentHubId();
  const isAdmin = useCan('UPDATE_HUB').allowed;
  const defaultTab: settingsTabs = isAdmin ? 'profile' : 'team';

  const { data: hub } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
  });
  const hasPendingApprovals = Boolean(hub?.pending_approvals && hub.pending_approvals > 0);

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('hubSettings') as settingsTabs) ?? defaultTab;
  const isOpen = searchParams.has('hubSettings');

  const openHubSettings = () => setSearchParams({ hubSettings: defaultTab });
  const onOpenChange = (open: boolean) => setSearchParams(open ? { hubSettings: defaultTab } : {});

  return { isOpen, tab, hasPendingApprovals, openHubSettings, onOpenChange };
};
