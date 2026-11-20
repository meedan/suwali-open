import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as NL from '@root/NetworkLayer';
import * as SessionContext from '@root/SessionContext';

import WordpressDetectedHint from './WordpressDetectedHint';

vi.mock('@root/NetworkLayer', () => ({
  NetworkLayer: { post: vi.fn(), get: vi.fn() },
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number) { super(); this.status = status; }
  },
  API_BASE_URL: '',
  getAuthToken: vi.fn(),
}));
vi.mock('@root/SessionContext');

const respondWith = (siteUrl: string | null) => {
  vi.mocked(NL.NetworkLayer.post).mockResolvedValue({ data: { site_url: siteUrl }, headers: new Headers(), status: 200 });
};

const renderComponent = (url: string, onSwitchToWordpress = vi.fn()) => {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <WordpressDetectedHint url={url} onSwitchToWordpress={onSwitchToWordpress} />
      </IntlProvider>
    </QueryClientProvider>
  );
  return onSwitchToWordpress;
};

describe('WordpressDetectedHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
  });

  it('checks the tidied-up URL for the current hub', async () => {
    respondWith(null);

    renderComponent('blog.example.com/feed');

    await waitFor(() =>
      expect(NL.NetworkLayer.post).toHaveBeenCalledWith('/sources/detect_wordpress', {
        hub_id: 1,
        url: 'https://blog.example.com/feed',
      })
    );
  });

  it('offers to continue with WordPress, passing on the detected site address', async () => {
    respondWith('https://blog.example.com');

    const onSwitchToWordpress = renderComponent('https://blog.example.com/feed');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with WordPress' }));

    expect(screen.getByText('This looks like a WordPress site')).toBeInTheDocument();
    expect(onSwitchToWordpress).toHaveBeenCalledWith('https://blog.example.com');
  });

  it('shows nothing when the URL is not a WordPress site', async () => {
    respondWith(null);

    renderComponent('https://example.org/articles');

    await waitFor(() => expect(NL.NetworkLayer.post).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Continue with WordPress' })).not.toBeInTheDocument();
  });

  it('does not check an invalid URL', async () => {
    renderComponent('not a url');

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(NL.NetworkLayer.post).not.toHaveBeenCalled();
  });
});
