import { useCallback } from 'react';

import { hubPath } from '@helpers/hubPath';

import { useSession } from '@root/SessionContext';

export const useHubPath = () => {
  const hubId = useSession().currentHubId();
  return useCallback((path: string) => hubPath(path, hubId), [hubId]);
};
