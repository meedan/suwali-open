import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';

import { HttpError } from '@root/NetworkLayer';

import { isUnavailableError, retryUnlessClientError } from './http';

describe('isUnavailableError', () => {
  it.each([404, 403])('is true for HTTP %i', (status) => {
    expect(isUnavailableError(new HttpError(status, {}, new Headers()))).toBe(true);
  });

  it.each([401, 500])('is false for HTTP %i', (status) => {
    expect(isUnavailableError(new HttpError(status, {}, new Headers()))).toBe(false);
  });

  it('is false for non-HTTP errors and null', () => {
    expect(isUnavailableError(new Error('boom'))).toBe(false);
    expect(isUnavailableError(null)).toBe(false);
  });
});

describe('retryUnlessClientError', () => {
  const httpError = (status: number) => new HttpError(status, {}, new Headers());

  it.each([401, 403, 404, 422])('does not retry HTTP %i', (status) => {
    expect(retryUnlessClientError(0, httpError(status))).toBe(false);
  });

  it.each([408, 429, 500, 503])('retries HTTP %i', (status) => {
    expect(retryUnlessClientError(0, httpError(status))).toBe(true);
  });

  it('retries network errors', () => {
    expect(retryUnlessClientError(0, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('gives up after 3 retries', () => {
    expect(retryUnlessClientError(2, httpError(500))).toBe(true);
    expect(retryUnlessClientError(3, httpError(500))).toBe(false);
  });
});

describe('retryUnlessClientError as a QueryClient default', () => {
  // Two observers on one key, the way /hubs/:id is used: neither needs its own `retry`
  it('does not retry a 404 no matter which observer subscribes first', async () => {
    const queryFn = vi.fn(async () => { throw new HttpError(404, {}, new Headers()); });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError, retryDelay: 1 } } });
    const Observer = () => {
      useQuery({ queryKey: ['/hubs/1'], queryFn });
      return null;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <Observer />
        <Observer />
      </QueryClientProvider>
    );

    await waitFor(() => expect(queryClient.getQueryState(['/hubs/1'])?.status).toBe('error'));
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
