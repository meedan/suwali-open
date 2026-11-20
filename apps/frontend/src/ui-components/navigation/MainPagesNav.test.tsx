import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import * as HubSettingsDialog from '@hooks/useHubSettingsDialog';

import MainPagesNav from './MainPagesNav';

vi.mock('@hooks/useCapabilities', () => ({ useCan: () => ({ allowed: true }) }));
vi.mock('@hooks/useHubPath', () => ({ useHubPath: () => (path: string) => path }));
vi.mock('@hooks/useHubSetupTasks', () => ({ useHubSetupTasks: () => ({ documentSynced: true }) }));
vi.mock('@hooks/useLastConversationsPath', () => ({ useLastConversationsPath: () => '/conversations/audience' }));
vi.mock('@hooks/useHubSettingsDialog', () => ({ useHubSettingsDialog: vi.fn() }));

const renderNav = (hasPendingApprovals: boolean) => {
  vi.mocked(HubSettingsDialog.useHubSettingsDialog).mockReturnValue(
    { hasPendingApprovals, openHubSettings: vi.fn() } as unknown as ReturnType<typeof HubSettingsDialog.useHubSettingsDialog>
  );
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <MainPagesNav />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );
};

describe('MainPagesNav', () => {
  it('announces pending approvals as part of the system settings button', () => {
    renderNav(true);

    expect(screen.getByRole('button', { name: /System settings/ })).toHaveAccessibleName(/Pending approvals/);
  });

  it('leaves pending approvals out when there are none', () => {
    renderNav(false);

    expect(screen.getByRole('button', { name: /System settings/ })).not.toHaveAccessibleName(/Pending approvals/);
  });
});
