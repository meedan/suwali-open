import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { stripHubPrefix } from '@helpers/hubPath';

import { useHubPath } from '@hooks/useHubPath';

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'remembered_search_params';

export type RouteIdentifier = string;

export interface UseRememberedSearchParamsOptions {
  routeId: RouteIdentifier;
  hubId: number | string | null;
  enabled?: boolean;
}

interface StoragePayload {
  version: number;
  searchParams: string;
  timestamp: number;
}

export function buildRememberKey({
  hubId,
  routeId
}: {
  hubId: number | string | null;
  routeId: RouteIdentifier;
}): string {
  if (!hubId) {
    return '';
  }
  return `${STORAGE_KEY_PREFIX}:v${STORAGE_VERSION}:hub_${hubId}:route_${routeId}`;
}

function saveSearchParams(key: string, searchParams: URLSearchParams): void {
  if (!key) return;

  const payload: StoragePayload = {
    version: STORAGE_VERSION,
    searchParams: searchParams.toString(),
    timestamp: Date.now(),
  };

  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save search params to localStorage:', error);
  }
}

function loadSearchParams(key: string): URLSearchParams | null {
  if (!key) return null;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const payload: StoragePayload = JSON.parse(stored);

    // Validate version
    if (payload.version !== STORAGE_VERSION) {
      localStorage.removeItem(key);
      return null;
    }

    return new URLSearchParams(payload.searchParams);
  } catch (error) {
    console.warn('Failed to load search params from localStorage:', error);
    return null;
  }
}

export function useRememberedSearchParams(options: UseRememberedSearchParamsOptions): void {
  const { routeId, hubId, enabled = true } = options;
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const hasInitializedRef = useRef(false);
  const currentRouteIdRef = useRef(routeId);

  const storageKey = buildRememberKey({ hubId, routeId });

  // Detect route changes
  useEffect(() => {
    if (currentRouteIdRef.current !== routeId) {
      // Route changed, reset initialization flag
      hasInitializedRef.current = false;
      currentRouteIdRef.current = routeId;
    }
  }, [routeId]);

  // Save search params whenever they change (but only after initial mount)
  useEffect(() => {
    if (!enabled || !hubId) return;

    // Check if current location matches our routeId (exact match)
    // This prevents saving when the component is unmounting and location has already changed
    if (stripHubPrefix(location.pathname) !== routeId) {
      return;
    }

    // On first mount, mark as initialized but don't save yet
    // This prevents overwriting saved params when component mounts
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }

    // Save current search params to storage
    saveSearchParams(storageKey, searchParams);
  }, [enabled, hubId, storageKey, searchParams, routeId, location.pathname]);
}

export function getRememberedSearchParams({
  hubId,
  routeId,
}: {
  hubId: number | string | null;
  routeId: RouteIdentifier;
}): URLSearchParams | null {
  const key = buildRememberKey({ hubId, routeId });
  return loadSearchParams(key);
}

function pathToRoutePattern(path: string): string {
  return path.split('?')[0]; // Remove query params
}

export function useNavigateWithRememberedParams(hubId: number | string | null) {
  const navigate = useNavigate();
  const hubPath = useHubPath();

  return useCallback((path: string, options?: { replace?: boolean }) => {
    const cleanPath = pathToRoutePattern(path);
    const savedParams = getRememberedSearchParams({ hubId, routeId: cleanPath });

    const url = savedParams && savedParams.toString()
      ? `${cleanPath}?${savedParams.toString()}`
      : cleanPath;

    navigate(hubPath(url), options);
  }, [hubId, hubPath, navigate]);
}
