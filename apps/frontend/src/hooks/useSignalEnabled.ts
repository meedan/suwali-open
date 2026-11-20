import { useSession } from '@root/SessionContext';

import { hubHasFeature } from '@components/FeatureFlag';

export const SIGNAL_FEATURE_FLAG = 'SIGNAL';

export const useSignalEnabled = () => {
  const hub = useSession().currentHub();
  return Boolean(hub && hubHasFeature(hub, SIGNAL_FEATURE_FLAG));
};
