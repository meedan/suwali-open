import { getLastPath } from '@helpers/lastPath';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

export const useLastConversationsPath = () => {
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();

  const lastPath = getLastPath('conversationsLastPath', hubId);

  return hubPath(lastPath ?? '/conversations/audience');
};
