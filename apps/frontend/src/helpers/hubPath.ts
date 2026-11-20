// Positive integers only: 0 is falsy, so SessionContext would treat /hub/0 as having no hub at all
const HUB_ID_PATTERN = '[1-9]\\d*';
const HUB_PREFIX_REGEX = new RegExp(`^/hub/(${HUB_ID_PATTERN})(/|$)`);
const HUB_ID_REGEX = new RegExp(`^${HUB_ID_PATTERN}$`);
// Static /hub/* routes that are not followed by a hub id
const RESERVED_HUB_SEGMENTS = ['join', 'setup'];

export function hubPath(path: string, hubId: number | string | null): string {
  if (!hubId) return path;
  const stripped = stripHubPrefix(path);
  return `/hub/${hubId}${stripped}`;
}

export function matchesHubPath(pathname: string, target: string): boolean {
  return stripHubPrefix(pathname) === target;
}

export function startsWithHubPath(pathname: string, target: string): boolean {
  return stripHubPrefix(pathname).startsWith(target);
}

export function stripHubPrefix(pathname: string): string {
  const match = pathname.match(HUB_PREFIX_REGEX);
  if (!match) return pathname;
  const rest = pathname.slice(match[0].length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

export function extractHubIdFromPath(pathname: string): number | null {
  const match = pathname.match(HUB_PREFIX_REGEX);
  return match ? Number(match[1]) : null;
}

export function isValidHubId(hubId: string | undefined): boolean {
  return hubId !== undefined && HUB_ID_REGEX.test(hubId);
}

// True for /hub/<something> where something is neither a valid hub id nor a static route, e.g.
// /hub/abc or /hub/0. Such URLs name no hub, so nothing hub-scoped should run for them.
export function hasInvalidHubPrefix(pathname: string): boolean {
  const segment = pathname.match(/^\/hub\/([^/]+)/)?.[1];
  return segment !== undefined && !RESERVED_HUB_SEGMENTS.includes(segment) && !isValidHubId(segment);
}
