/* eslint-disable react-refresh/only-export-components */
// Context provider + hook pattern: keeping these together is standard for React context patterns and won't break Fast Refresh
import { createContext, useContext, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { Hub } from "@customTypes/hub";
import type { User } from "@customTypes/user";

import { isUnavailableError } from "@helpers/http";
import { extractHubIdFromPath, hasInvalidHubPrefix } from "@helpers/hubPath";

import { fetchHub } from "@services/HubService";
import { fetchMe } from "@services/ProfileService";

import { useHubPath } from '@hooks/useHubPath';


const STORAGE_VERSION = 1;
const HUB_STALE_TIME = 5 * 60 * 1000;

const hubQueryOptions = (hubId: number) => ({
  queryKey: [`/hubs/${hubId}`],
  queryFn: () => fetchHub(hubId),
  staleTime: HUB_STALE_TIME,
});

const buildStorageKey = (userId: number): string => {
  return `currentHubId:v${STORAGE_VERSION}:user_${userId}`;
};

const getStoredHubId = (userId: number): number | null => {
  const stored = localStorage.getItem(buildStorageKey(userId));
  return stored ? Number(stored) : null;
};

const storeHubId = (userId: number, hubId: number | null) => {
  const storageKey = buildStorageKey(userId);
  if (hubId) {
    localStorage.setItem(storageKey, String(hubId));
  } else {
    localStorage.removeItem(storageKey);
  }
};

const SessionContext = createContext<{
  user: User | null;
  setUser: (user: User) => void;
  isLoggedIn: () => boolean;
  isSuperAdminGuest: () => boolean;
  currentHub: () => Hub | null | undefined;
  currentHubId: () => number | null;
  hubUnavailable: () => boolean;
  setCurrentHubId: (hubId: number | null) => Promise<void>;
  restore: () => Promise<User | null>;
  refreshUser: () => Promise<void>;
}>({
  user: null,
  setUser: () => null,
  isLoggedIn: () => false,
  isSuperAdminGuest: () => false,
  currentHub: () => undefined,
  currentHubId: () => null,
  hubUnavailable: () => false,
  setCurrentHubId: async () => {},
  restore: async () => null,
  refreshUser: async () => {},
});

type SessionProviderProps = {
  children: React.ReactNode;
};

const SessionProvider = ({ children }: SessionProviderProps) => {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const [user, setUser] = useState<User | null>(null);

  const isLoggedIn = () => Boolean(user?.id);

  const urlHubId = extractHubIdFromPath(location.pathname);
  const resolvedHubId = user ? (urlHubId ?? getStoredHubId(user.id) ?? user.hubs?.[0]?.id ?? null) : null;

  const { data: fetchedHub, error: hubError } = useQuery({
    ...hubQueryOptions(resolvedHubId!),
    enabled: Boolean(resolvedHubId),
    initialData: () => resolvedHubId ? queryClient.getQueryData<Hub>([`/hubs/${resolvedHubId}`]) : undefined,
  });

  // undefined = still loading, null = user has no hub
  const currentHub = (): Hub | null | undefined => {
    if (!resolvedHubId) return null;
    return fetchedHub ?? undefined;
  };

  const currentHubId = () => resolvedHubId;

  // Only a hub named in the URL counts: a bad stored/default hub is not something the user typed,
  // and the "not available" page sends them back to that default. A URL that names no valid hub
  // (/hub/abc, /hub/0) is unavailable too, so nothing hub-scoped runs against the default hub for it.
  const hubUnavailable = () => isLoggedIn()
    && (hasInvalidHubPrefix(location.pathname) || (urlHubId !== null && isUnavailableError(hubError)));

  const isSuperAdminGuest = () => Boolean(user?.is_admin && resolvedHubId && !user?.hubs?.some(h => h.id === resolvedHubId));

  const setCurrentHubId = async (hubId: number | null) => {
    if (!user) return;
    if (hubId) {
      storeHubId(user.id, hubId);
      navigate(hubPath('/dashboard'));
    }
  };

  const restore = async (): Promise<User | null> => {
    console.log('Restoring session...');

    if (user) {
      return user;
    } else if (localStorage.getItem('authToken')) {
      const restoredUser = await fetchMe();
      const hubId = getStoredHubId(restoredUser.id) ?? restoredUser.hubs?.[0]?.id;
      if (hubId) {
        await queryClient.fetchQuery(hubQueryOptions(hubId));
      }
      setUser(restoredUser);
      return restoredUser;
    } else {
      return null;
    }
  };

  const refreshUser = async (): Promise<void> => {
    queryClient.invalidateQueries({ queryKey: ['/me'] });

    setUser(await fetchMe());
  };

  const value = {
    user,
    currentHub,
    currentHubId,
    hubUnavailable,
    setCurrentHubId,
    isLoggedIn,
    isSuperAdminGuest,
    restore,
    setUser,
    refreshUser,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

const useSession = () => useContext(SessionContext);

export default SessionProvider;
export { useSession };
