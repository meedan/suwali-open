import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ExternalUser } from '@customTypes/external-user';

import TrustedEndUserActionsMenu from './TrustedEndUserActionsMenu';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

vi.mock('@components/ConfirmTrustedUserStatusModal', () => ({
  default: () => null,
}));

const user: ExternalUser = {
  type: 'ExternalUser',
  id: 1,
  name: 'Alice',
  platform: 'whatsapp',
  external_id: '15550000000',
  trusted_user: true,
  last_conversation_id: 42,
  first_message_at: '',
  last_message_at: '',
  messages_count: 0,
};

const renderMenu = (overrides: Partial<ExternalUser> = {}) =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <TrustedEndUserActionsMenu user={{ ...user, ...overrides }} />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('TrustedEndUserActionsMenu', () => {
  it('renders the More button', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('shows View conversation when last_conversation_id is present', () => {
    renderMenu({ last_conversation_id: 42 });
    expect(screen.getByRole('button', { name: 'View conversation' })).toBeInTheDocument();
  });

  it('hides View conversation when last_conversation_id is null', () => {
    renderMenu({ last_conversation_id: null });
    expect(screen.queryByRole('button', { name: 'View conversation' })).not.toBeInTheDocument();
  });

  it('shows Remove when user can manage external users', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
