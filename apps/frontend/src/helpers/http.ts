import { HttpError } from '@root/NetworkLayer';

// 404 for a missing record; the API also answers 404 for a hub the user is not a member of
// and 403 for a pending membership. All of them mean "this content is not available".
export const isUnavailableError = (error: unknown): boolean =>
  error instanceof HttpError && (error.status === 404 || error.status === 403);

// 408 and 429 are the client errors that can clear on their own.
const RETRYABLE_CLIENT_STATUSES = [408, 429];

// react-query `retry` option: a 4xx means the request itself is the problem (missing record,
// no access, invalid input), so retrying cannot help. Fail straight to the error state instead
// of spinning through the default retries. Network errors and 5xx still retry.
export const retryUnlessClientError = (failureCount: number, error: unknown): boolean => {
  const isClientError = error instanceof HttpError
    && error.status >= 400 && error.status < 500
    && !RETRYABLE_CLIENT_STATUSES.includes(error.status);
  return !isClientError && failureCount < 3;
};
