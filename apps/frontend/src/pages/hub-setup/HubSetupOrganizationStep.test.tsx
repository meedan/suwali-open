import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { About } from '@services/AboutService';
import * as AboutService from '@services/AboutService';
import * as HubService from '@services/HubService';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import HubSetupOrganizationStep from './HubSetupOrganizationStep';

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

vi.mock('@services/HubService');
vi.mock('@services/AboutService');

const renderComponent = (locationState?: { canGoBack?: boolean }) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ToastPrimitive.Provider>
            <ToastProvider>
              <MemoryRouter initialEntries={[{ pathname: '/hub/setup', state: locationState }]}>
                <Routes>
                  <Route path="/hub/setup" element={<HubSetupOrganizationStep />} />
                  <Route path="/hub/join" element={<div>Join hub page</div>} />
                </Routes>
              </MemoryRouter>
            </ToastProvider>
            <ToastPrimitive.Viewport />
          </ToastPrimitive.Provider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('HubSetupOrganizationStep', () => {
  beforeEach(() => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      user: { email: 'alice@acme.com', is_public_email_domain: false },
      refreshUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(AboutService.fetchAbout).mockResolvedValue({ hub_trial_length_days: 14 } as unknown as About);
  });

  it('shows a validation error and does not create a hub when submitted without a name', async () => {
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      expect(screen.getByText('Please provide an organization name.')).toBeInTheDocument();
    });
    expect(HubService.createHub).not.toHaveBeenCalled();
  });

  it('creates the hub and refreshes the session when submitted with a name', async () => {
    vi.mocked(HubService.createHub).mockResolvedValue({ id: 1, name: 'Acme' } as unknown as Awaited<ReturnType<typeof HubService.createHub>>);
    const session = SessionContext.useSession();
    renderComponent();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      expect(HubService.createHub).toHaveBeenCalledWith({ name: 'Acme', file: null });
    });
    expect(session.refreshUser).toHaveBeenCalled();
  });

  it('shows an error toast when hub creation fails', async () => {
    vi.mocked(HubService.createHub).mockRejectedValue(new Error('boom'));
    renderComponent();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
  });

  it('only shows the corporate invite tip once an organization name has been entered', async () => {
    renderComponent();

    expect(screen.queryByText(/invite team members/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } });

    await waitFor(() => {
      expect(screen.getByText(/invite team members/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('does not show the corporate invite tip for a public email domain', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      user: { email: 'alice@gmail.com', is_public_email_domain: true },
      refreshUser: vi.fn(),
    } as unknown as ReturnType<typeof SessionContext.useSession>);
    renderComponent();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } });

    expect(screen.queryByText(/invite team members/i)).not.toBeInTheDocument();
  });

  it('shows a back-to-list link that navigates to /hub/join when canGoBack is set', () => {
    renderComponent({ canGoBack: true });

    fireEvent.click(screen.getByRole('button', { name: 'Back to list of organizations' }));

    expect(screen.getByText('Join hub page')).toBeInTheDocument();
  });

  it('does not show a back-to-list link when canGoBack is not set', () => {
    renderComponent();

    expect(screen.queryByRole('button', { name: 'Back to list of organizations' })).not.toBeInTheDocument();
  });
});
