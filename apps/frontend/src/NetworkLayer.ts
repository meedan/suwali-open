import * as Sentry from '@sentry/react';

import { getStoredLocale } from '@components/LanguageProvider';

import Config from './Config';

export const API_BASE_URL = Config.get('VITE_API_BASE_URL', 'http://localhost:3000/api');

export interface NetworkResponse<T = unknown> {
  data: T;
  headers: Headers;
  status: number;
}

// Whether this tab is signed in. Kept in memory because localStorage is shared: when another tab
// logs out, this tab's token disappears too, but its 401s still mean a session ended rather than a
// failed sign-in.
let hasSession = Boolean(localStorage.getItem('authToken'));

export const setAuthToken = (token: string) => {
  localStorage.setItem('authToken', token);
  hasSession = true;
};

export const getAuthToken = (): string => {
  return localStorage.getItem('authToken') || '';
};

export const clearAuthToken = (): void => {
  localStorage.removeItem('authToken');
  hasSession = false;
};

export const getDefaultHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Authorization': getAuthToken(),
  'Accept-Language': getStoredLocale(),
});

type ApiErrorData = { errors?: string[] | string; message?: string } | string | null;

export const sanitizeApiErrors = (data: ApiErrorData): string | null => {
  if (data === null) return null;
  if (typeof data === 'string') return data;

  const obj = data as { errors?: string[] | string; message?: string };

  if (Array.isArray(obj.errors) && obj.errors.length) return obj.errors.join(', ');
  if (typeof obj.errors === 'string' && obj.errors) return obj.errors;
  if (typeof obj.message === 'string' && obj.message) return obj.message;

  return null;
};

type HttpErrorData = { error?: string; error_code?: string; errors?: string[] | string; message?: string } | null;

export class HttpError extends Error {
  status: number;
  data: HttpErrorData;
  headers: Headers;

  constructor(status: number, body: unknown, headers: Headers) {
    // The body is whatever JSON the API returned for the error, so its shape is taken on trust
    const data = body as HttpErrorData;
    const errors = Array.isArray(data?.errors) ? data.errors.join('\n') : data?.errors;
    super(data?.error || errors || `HTTP ${status}`);
    this.name = "HttpError";

    this.status = status;
    this.data = data;
    this.headers = headers;
  }
};

// The request never reached the API: the device is offline, or the connection or the API is down
export class NetworkError extends Error {
  // The browser's own error, e.g. TypeError('Failed to fetch')
  cause: unknown;

  constructor(cause?: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
};

const FIRST_PROBE_DELAY = 5_000;
const MAX_PROBE_DELAY = 60_000;
const PROBE_TIMEOUT = 10_000;

export type ApiReachability = {
  reachable: boolean;
  probing: boolean;
  // When the next check runs on its own; null while none is scheduled
  nextProbeAt: number | null;
};

let reachability: ApiReachability = { reachable: true, probing: false, nextProbeAt: null };
let failedProbes = 0;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let probeController: AbortController | undefined;
const reachabilityListeners = new Set<() => void>();

type FailedRequest = {
  method: string;
  path: string;
  error: unknown;
};

let lastFailure: FailedRequest | null = null;
let outage: (FailedRequest & { since: number; browserOnline: boolean }) | null = null;

const recordFailure = (method: string, path: string, error: unknown) => {
  lastFailure = { method, path, error };
};

const outageAttributes = ({ method, path, error, browserOnline }: NonNullable<typeof outage>) => ({
  // Without the query string, which may hold search terms
  failedRequest: `${method} ${path.split('?')[0]}`,
  error: error instanceof Error ? error.message : String(error),
  // false: the device itself went offline. true: it had a connection but could not reach the API
  // (the API or a proxy is down, a firewall, DNS, CORS, a captive portal...)
  browserOnline,
});

// Logged once per outage rather than once per failed request, and as logs rather than issues because a
// lost connection is not a bug in the app. Logged both when the API goes down, which reaches Sentry
// when only the API is blocked (it may never come back for this user), and when it comes back, which
// reaches Sentry when the device was offline and gives how long the outage lasted.
const startOutage = (failure: FailedRequest) => {
  outage = { ...failure, since: Date.now(), browserOnline: navigator.onLine };
  Sentry.logger.warn('API unreachable', outageAttributes(outage));
};

const endOutage = () => {
  if (!outage) return;

  Sentry.logger.info('API reachable again', { ...outageAttributes(outage), durationMs: Date.now() - outage.since });
  outage = null;
};

const updateReachability = (next: ApiReachability) => {
  if (next.reachable === reachability.reachable && next.probing === reachability.probing && next.nextProbeAt === reachability.nextProbeAt) return;

  if (reachability.reachable && !next.reachable && lastFailure) {
    startOutage(lastFailure);
  } else if (!reachability.reachable && next.reachable) {
    endOutage();
  }

  reachability = next;
  reachabilityListeners.forEach((listener) => listener());
};

const scheduleProbe = () => {
  const delay = Math.min(FIRST_PROBE_DELAY * 2 ** failedProbes, MAX_PROBE_DELAY);
  clearTimeout(probeTimer);
  probeTimer = setTimeout(probeApiNow, delay);
  updateReachability({ reachable: false, probing: false, nextProbeAt: Date.now() + delay });
};

export const probeApiNow = () => {
  if (reachability.probing) return;

  clearTimeout(probeTimer);
  // A check started while reachable is the first one after the connection drops, not a retry
  const isRetry = !reachability.reachable;
  updateReachability({ ...reachability, probing: true, nextProbeAt: null });

  const controller = new AbortController();
  probeController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PROBE_TIMEOUT);

  // Any response, even an error status, means the API can be reached
  fetch(`${API_BASE_URL}/about`, { cache: 'no-store', signal: controller.signal }).then(
    () => {
      clearTimeout(timeout);
      failedProbes = 0;
      updateReachability({ reachable: true, probing: false, nextProbeAt: null });
    },
    (error: unknown) => {
      clearTimeout(timeout);
      if (controller.signal.aborted && !timedOut) return;

      recordFailure('GET', '/about', timedOut ? new Error(`No response after ${PROBE_TIMEOUT}ms`) : error);
      if (isRetry) failedProbes += 1;
      scheduleProbe();
    },
  );
};

const setApiReachable = (reachable: boolean) => {
  if (reachable) {
    if (reachability.reachable && !reachability.probing) return;

    // A response settles what the check in flight was asking, so its late failure must not undo it
    probeController?.abort();
    clearTimeout(probeTimer);
    failedProbes = 0;
    updateReachability({ reachable: true, probing: false, nextProbeAt: null });
    return;
  }

  if (!reachability.reachable) return;

  clearTimeout(probeTimer);
  failedProbes = 0;
  if (reachability.probing) {
    // The check in flight schedules the next one when it fails
    updateReachability({ ...reachability, reachable: false });
  } else {
    scheduleProbe();
  }
};

export const getApiReachability = (): ApiReachability => reachability;

export const isApiReachable = (): boolean => reachability.reachable;

export const subscribeToApiReachability = (listener: () => void): (() => void) => {
  reachabilityListeners.add(listener);
  return () => reachabilityListeners.delete(listener);
};

// Resolves the next time a request reaches the API, or right away if the last one did
export const whenApiReachable = (): Promise<void> => new Promise((resolve) => {
  if (reachability.reachable) return resolve();

  const unsubscribe = subscribeToApiReachability(() => {
    if (!reachability.reachable) return;

    unsubscribe();
    resolve();
  });
});

// A dead session (401 revoked token, 429 locked account) is rejected on every
// route, so clear it once here instead of letting each caller render its own error.
// Returns true when the session was ended and the page is reloading.
// Requests already in flight fail after the token is cleared, so remember that the session
// ended rather than treating them as anonymous 401s (e.g. a failed login) and throwing.
let sessionEnded = false;

const endSessionIfRejected = ({ status, data }: HttpError): boolean => {
  const accountLocked = status === 429 && data?.error_code === 'login_attempts_rate_limit_exceeded';
  if (status !== 401 && !accountLocked) return false;
  if (sessionEnded) return true;
  if (!hasSession) return false;

  // Carry the API's own message across the reload rather than restating it here.
  if (data?.error) sessionStorage.setItem('sessionEndedReason', data.error);

  sessionEnded = true;
  clearAuthToken();
  window.location.assign('/');
  return true;
};

// The reload does not stop running code, so a thrown error would still reach callers and their
// error boundaries (rendering the error page and reporting to Sentry) before the page unloads.
// Leaving the request pending instead keeps them in their loading state until it does.
const pendingUntilReload = (): Promise<never> => new Promise(() => {});

type RequestOptions = RequestInit & { headers?: Record<string, string> };

const request = async <T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<NetworkResponse<T>> => {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { ...getDefaultHeaders(), ...options.headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...options,
    });
  } catch (error) {
    // A cancelled request says nothing about the connection
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    recordFailure(method, path, error);
    setApiReachable(false);
    throw new NetworkError(error);
  }

  setApiReachable(true);

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new HttpError(response.status, data, response.headers);
    if (endSessionIfRejected(error)) return pendingUntilReload();
    throw error;
  }

  return { data: data as T, headers: response.headers, status: response.status };
};

export const NetworkLayer = {
  get: <T = unknown>(path: string, options: RequestOptions = {}) => request<T>('GET', path, undefined, options),
  post: <T = unknown>(path: string, body: unknown, options: RequestOptions = {}) => request<T>('POST', path, body, options),
  patch: <T = unknown>(path: string, body: unknown, options: RequestOptions = {}) => request<T>('PATCH', path, body, options),
  put: <T = unknown>(path: string, body: unknown, options: RequestOptions = {}) => request<T>('PUT', path, body, options),
  delete: <T = unknown>(path: string, options: RequestOptions = {}) => request<T>('DELETE', path, undefined, options),
};
