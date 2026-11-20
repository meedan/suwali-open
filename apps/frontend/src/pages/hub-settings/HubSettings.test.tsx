import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import * as HubService from '@services/HubService';

import HubSettings from './HubSettings';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@services/HubService', () => ({ fetchHub: vi.fn() }));

vi.mock('@hooks/useCapabilities', () => ({ useCan: () => ({ allowed: true }) }));

vi.mock('@components/Can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Each tab's content has its own tests; only the menu is under test here
vi.mock('./Billing', () => ({ default: () => null }));
vi.mock('./MessagingIntegrations', () => ({ default: () => null }));
vi.mock('./Profile', () => ({ default: () => null }));
vi.mock('./Team', () => ({ default: () => null }));

const renderSettings = (pendingApprovals: number) => {
  vi.mocked(HubService.fetchHub).mockResolvedValue({ id: 1, pending_approvals: pendingApprovals } as Awaited<ReturnType<typeof HubService.fetchHub>>);
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IntlProvider locale="en" messages={{}}>
          <HubSettings tab="profile" />
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe('HubSettings', () => {
  it('shows the settings as a menu with the current tab checked', () => {
    renderSettings(0);

    expect(screen.getByRole('menu', { name: 'Settings menu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Profile' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Team' })).toHaveAttribute('aria-checked', 'false');
  });

  it('announces pending approvals as part of the Team item', async () => {
    renderSettings(2);

    expect(await screen.findByRole('menuitemradio', { name: 'Team Pending approvals' })).toBeInTheDocument();
  });
});
