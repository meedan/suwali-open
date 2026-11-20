import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { WORDPRESS_AUTHORIZATION_CHANNEL } from '@helpers/wordpressAuthorization';

import WordpressAuthorized from './WordpressAuthorized';

describe('WordpressAuthorized', () => {
  let channel: BroadcastChannel;
  let received: unknown[];

  beforeEach(() => {
    received = [];
    channel = new BroadcastChannel(WORDPRESS_AUTHORIZATION_CHANNEL);
    channel.onmessage = (event) => received.push(event.data);
    vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    channel.close();
    vi.restoreAllMocks();
  });

  const renderAt = (url: string) => {
    window.history.replaceState(null, '', url);
    return render(
      <IntlProvider locale="en" messages={{}}>
        <WordpressAuthorized />
      </IntlProvider>
    );
  };

  it('passes the approval to the wizard, removes the password from the address and closes', async () => {
    renderAt('/wordpress/authorized?state=abc&site_url=https%3A%2F%2Fblog.example.com&user_login=admin&password=secret');

    await waitFor(() => expect(received).toEqual([
      { state: 'abc', status: 'approved', userLogin: 'admin', password: 'secret' },
    ]));
    expect(window.location.search).toBe('');
    expect(window.close).toHaveBeenCalled();
    expect(screen.getByText('You can close this window and go back to Suwali.')).toBeInTheDocument();
  });

  it('does nothing without a state', async () => {
    renderAt('/wordpress/authorized');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([]);
    expect(window.close).not.toHaveBeenCalled();
  });
});
