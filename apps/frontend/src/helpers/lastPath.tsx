import { stripHubPrefix } from '@helpers/hubPath';

const STORAGE_VERSION = 2;

const buildStorageKey = (
  keyName: string,
  hubId: number | string | null
) => {
  return `${keyName}:v${STORAGE_VERSION}:hub_${hubId}`;
};

// Without a hub the key would be shared by every hub; storage errors (quota, blocked storage) only lose the memory
export const getLastPath = (
  keyName: string,
  hubId: number | string | null
): string | null => {
  if (!hubId) return null;
  try {
    return localStorage.getItem(buildStorageKey(keyName, hubId));
  } catch {
    return null;
  }
};

export const setLastPath = (
  keyName: string,
  hubId: number | string | null,
  path: string
) => {
  if (!hubId) return;
  try {
    localStorage.setItem(buildStorageKey(keyName, hubId), stripHubPrefix(path));
  } catch {
    // Remembering the path is best-effort
  }
};

export const removeLastPath = (
  keyName: string,
  hubId: number | string | null
) => {
  if (!hubId) return;
  try {
    localStorage.removeItem(buildStorageKey(keyName, hubId));
  } catch {
    // Remembering the path is best-effort
  }
};

export const getIdFromParamsOrLastPath = (
  paramsId: string | undefined,
  keyName: string,
  hubId: number | string | null,
  pathPattern: RegExp
): number | null => {
  if (paramsId) {
    return parseInt(paramsId, 10);
  }

  const lastPath = getLastPath(keyName, hubId);

  if (lastPath){
    const match = lastPath.match(pathPattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  return null;
};
