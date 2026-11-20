import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { fetchAdminHubDetail } from '@services/AdminService';

import { HttpError } from '@root/NetworkLayer';
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { ToastProvider } from '@hooks/useToast';

import HubDetails from './HubDetails';

// Real queries here, unlike HubDetails.test.tsx, so the page, its query and the error boundary run together
vi.mock('@services/AdminService');

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

const renderHubDetails = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/platform-admin/hubs/409999']}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              <SuwaliErrorBoundary>
                <Routes>
                  <Route path="/platform-admin/hubs/:hubId" element={<HubDetails />} />
                </Routes>
              </SuwaliErrorBoundary>
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe('HubDetails with a hub that is not available', () => {
  beforeEach(() => {
    // React reports every error a boundary catches to console.error, which the test setup turns into a failure
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([404, 403])('shows the not available page, with its own tab title, for a %i', async (status) => {
    vi.mocked(fetchAdminHubDetail).mockRejectedValue(new HttpError(status, {}, new Headers()));

    renderHubDetails();

    expect(await screen.findByText('This content is not available')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin dashboard' })).not.toBeInTheDocument();
    expect(document.title).toMatch(/^Page not found \|/);
  });
});
