import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WORDPRESS_AUTHORIZATION_CHANNEL, type WordpressAuthorizationResult } from '@helpers/wordpressAuthorization';

import * as SourcesService from '@services/SourcesService';

import WordpressWizardApproveSuwali from './WordpressWizardApproveSuwali';

vi.mock('@services/SourcesService');

const successUrl = 'https://app.suwali.io/wordpress/authorized?state=signed-state';
const authorizeUrl = `https://blog.example.com/wp-admin/authorize-application.php?app_name=Suwali&success_url=${encodeURIComponent(successUrl)}`;
const payload = { source: { hub_id: 1, source_type: 'wordpress_api', config: { site_url: 'https://blog.example.com' } } };
const onVerified = vi.fn();

const approval: WordpressAuthorizationResult = { state: 'signed-state', status: 'approved', userLogin: 'admin', password: 'secret' };

const renderComponent = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <WordpressWizardApproveSuwali authorizeUrl={authorizeUrl} payload={payload} onVerified={onVerified} />
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('WordpressWizardApproveSuwali', () => {
  let channel: BroadcastChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new BroadcastChannel(WORDPRESS_AUTHORIZATION_CHANNEL);
  });

  afterEach(() => {
    channel.close();
    vi.restoreAllMocks();
  });

  it('opens the site’s approval page in a window that cannot reach back into Suwali', () => {
    const popup = { opener: window, location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: 'Approve on WordPress' }));

    expect(open).toHaveBeenCalledWith('', 'suwali-wordpress-authorization', expect.any(String));
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe(authorizeUrl);
  });

  it('explains when the browser blocks the window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: 'Approve on WordPress' }));

    expect(screen.getByText('Your browser blocked the WordPress window')).toBeInTheDocument();
  });

  it('verifies the approval WordPress sends back', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockResolvedValue({ verified: true, receipt: 'signed-receipt', password_revoked: true });

    renderComponent();
    channel.postMessage(approval);

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('signed-receipt', true));
    expect(SourcesService.verifySourceOwnership).toHaveBeenCalledWith({
      ...payload,
      authorization: { state: 'signed-state', user_login: 'admin', password: 'secret' },
    });
  });

  it('ignores an approval meant for another wizard', async () => {
    renderComponent();
    channel.postMessage({ ...approval, state: 'other-state' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(SourcesService.verifySourceOwnership).not.toHaveBeenCalled();
  });

  it('explains when the user who approved does not manage the site', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockResolvedValue({ verified: false, reason: 'not_admin', password_revoked: false });

    renderComponent();
    channel.postMessage(approval);

    expect(await screen.findByText('Your WordPress account isn’t an administrator of this site')).toBeInTheDocument();
    expect(screen.getByText(/You can revoke “Suwali” under Application Passwords/)).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('suggests the tagline when the site refuses the approval', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockResolvedValue({ verified: false, reason: 'rejected', password_revoked: false });

    renderComponent();
    channel.postMessage(approval);

    expect(await screen.findByText('Your site didn’t accept the approval')).toBeInTheDocument();
  });

  it('explains when the user rejects Suwali', async () => {
    renderComponent();
    channel.postMessage({ state: 'signed-state', status: 'rejected' });

    expect(await screen.findByText('Suwali wasn’t approved')).toBeInTheDocument();
  });

  it('explains when Application Passwords are turned off for the user', async () => {
    renderComponent();
    channel.postMessage({ state: 'signed-state', status: 'disabled' });

    expect(await screen.findByText('Application Passwords are turned off for your account')).toBeInTheDocument();
  });
});
