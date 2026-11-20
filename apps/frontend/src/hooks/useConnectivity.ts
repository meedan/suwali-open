import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

import { getApiReachability, probeApiNow, subscribeToApiReachability } from '@root/NetworkLayer';

const subscribeToOnline = (listener: () => void) => onlineManager.subscribe(listener);
const isOnline = () => onlineManager.isOnline();

// Whether the browser is online and the last request reached the API. The browser alone can't
// tell a captive portal or a dropped API from a working connection.
export const useConnectivity = () => {
  const online = useSyncExternalStore(subscribeToOnline, isOnline);
  const { reachable, probing, nextProbeAt } = useSyncExternalStore(subscribeToApiReachability, getApiReachability);

  return { connected: online && reachable, probing, nextProbeAt, retryNow: probeApiNow };
};
