/* eslint-disable react-refresh/only-export-components */
import type { Hub } from "@customTypes/hub";

import { useSession } from "@root/SessionContext";

export const hubHasFeature = (hub: Hub, flag: string) => {
  const featureMap = hub.allowed_features || {};

  if (Object.prototype.hasOwnProperty.call(featureMap, flag)) {
    return featureMap[flag];
  }
  return false;
};

type FeatureFlagProps = {
  flag: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

const FeatureFlag = ({
  flag,
  fallback,
  children,
 }: FeatureFlagProps) => {
  const hub = useSession().currentHub();

  if (!hub) {
    return fallback || null;
  }

  if (hubHasFeature(hub, flag)) {
    return <>{children}</>;
  }

  return fallback || null;
};

export default FeatureFlag;
