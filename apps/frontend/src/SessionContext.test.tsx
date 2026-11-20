import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { User } from '@customTypes/user';

import * as HubService from '@services/HubService';

import { HttpError } from '@root/NetworkLayer';

import SessionProvider, { useSession } from './SessionContext';

vi.mock('@services/HubService');

const Probe = () => {
  const session = useSession();
  return (
    <>
      <button onClick={() => session.setUser({ id: 1, hubs: [{ id: 5 }] } as User)}>Log in</button>
      <span>{`unavailable:${session.hubUnavailable()}`}</span>
    </>
  );
};

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

const logIn = () => fireEvent.click(screen.getByText('Log in'));

describe('SessionProvider hubUnavailable', () => {
  it.each(['/hub/0/dashboard', '/hub/abc/dashboard'])('is true for %s as soon as the user is logged in', (url) => {
    vi.mocked(HubService.fetchHub).mockReturnValue(new Promise(() => {}));
    renderAt(url);

    logIn();

    expect(screen.getByText('unavailable:true')).toBeInTheDocument();
    // The hub query must not run for a URL that names no hub
    expect(HubService.fetchHub).not.toHaveBeenCalledWith(0);
  });

  it('is false when logged out', () => {
    renderAt('/hub/abc/dashboard');

    expect(screen.getByText('unavailable:false')).toBeInTheDocument();
  });

  it('is true once the hub in the URL fails with a 404', async () => {
    vi.mocked(HubService.fetchHub).mockRejectedValue(new HttpError(404, {}, new Headers()));
    renderAt('/hub/409999/dashboard');

    logIn();

    await waitFor(() => expect(screen.getByText('unavailable:true')).toBeInTheDocument());
  });

  it('is false for a hub that loads, and for static hub routes', async () => {
    vi.mocked(HubService.fetchHub).mockResolvedValue({ id: 5 } as Awaited<ReturnType<typeof HubService.fetchHub>>);
    renderAt('/hub/5/dashboard');
    logIn();
    await waitFor(() => expect(HubService.fetchHub).toHaveBeenCalledWith(5));
    expect(screen.getByText('unavailable:false')).toBeInTheDocument();
  });

  it.each(['/hub/join', '/hub/setup'])('is false for %s', (url) => {
    vi.mocked(HubService.fetchHub).mockReturnValue(new Promise(() => {}));
    renderAt(url);

    logIn();

    expect(screen.getByText('unavailable:false')).toBeInTheDocument();
  });
});
