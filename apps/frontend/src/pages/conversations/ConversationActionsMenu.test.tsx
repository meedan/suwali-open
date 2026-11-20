import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Conversation } from '@customTypes/conversation';
import type { Capabilities } from '@customTypes/hub';

import { downloadExport } from '@services/ExportService';

import { HttpError } from '@root/NetworkLayer';

import { useCan } from '@hooks/useCapabilities';

import ConversationActionsMenu from './ConversationActionsMenu';

const toast = vi.fn();

vi.mock('@services/ExportService', () => ({ downloadExport: vi.fn() }));

vi.mock('@hooks/useCapabilities', () => ({ useCan: vi.fn() }));

vi.mock('@hooks/useToast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const conversation = { id: 7, hub_id: 3, platform: 'telegram' } as Conversation;

const allow = (...actions: (keyof Capabilities)[]) =>
  vi.mocked(useCan).mockImplementation(action => ({ allowed: actions.includes(action) }));

const renderMenu = (overrides: Partial<Conversation> = {}) => {
  const onShowUserDetails = vi.fn();
  const onAddToNotebook = vi.fn();

  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <ConversationActionsMenu
          conversation={{ ...conversation, ...overrides }}
          onShowUserDetails={onShowUserDetails}
          onAddToNotebook={onAddToNotebook}
        />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

  return { onShowUserDetails, onAddToNotebook };
};

describe('ConversationActionsMenu', () => {
  const { createObjectURL, revokeObjectURL } = window.URL;

  beforeEach(() => {
    allow('CREATE_NOTEBOOK_ITEM', 'IS_ADMIN');
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:export');
    window.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    vi.clearAllMocks();
  });

  it('opens the end-user details and the notebook dialogs', () => {
    const { onShowUserDetails, onAddToNotebook } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'End-user details' }));
    expect(onShowUserDetails).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Include in notebooks' }));
    expect(onAddToNotebook).toHaveBeenCalled();
  });

  it('has no end-user details for an internal conversation', () => {
    renderMenu({ platform: 'internal' });

    expect(screen.queryByRole('button', { name: 'End-user details' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('hides the notebook option from users who cannot add to notebooks', () => {
    allow('IS_ADMIN');
    renderMenu();

    expect(screen.queryByRole('button', { name: 'Include in notebooks' })).not.toBeInTheDocument();
  });

  it('is not shown when it would have no options', () => {
    allow();
    renderMenu({ platform: 'internal' });

    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  describe('Export as CSV', () => {
    it('is hidden from users who are not super admins', () => {
      allow('CREATE_NOTEBOOK_ITEM');
      renderMenu();

      expect(screen.queryByRole('button', { name: 'Export as CSV' })).not.toBeInTheDocument();
    });

    it('downloads the conversation CSV from the hub-nested export endpoint', async () => {
      const blob = new Blob(['csv']);
      vi.mocked(downloadExport).mockResolvedValue(blob);
      renderMenu();

      fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));

      await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob));
      expect(downloadExport).toHaveBeenCalledWith('/hubs/3/conversations/7/export');
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
      expect(toast).not.toHaveBeenCalled();
    });

    it('is disabled while the download is in progress', async () => {
      let resolve: (blob: Blob) => void = () => {};
      vi.mocked(downloadExport).mockReturnValue(new Promise(r => { resolve = r; }));
      renderMenu();

      const button = screen.getByRole('button', { name: 'Export as CSV' });
      fireEvent.click(button);

      await waitFor(() => expect(button).toBeDisabled());
      resolve(new Blob(['csv']));
      await waitFor(() => expect(button).toBeEnabled());
    });

    it('shows the API error in a toast when the download fails', async () => {
      vi.mocked(downloadExport).mockRejectedValue(new HttpError(403, { error: 'Permission denied' }, new Headers()));
      renderMenu();

      fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));

      await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Permission denied'));
      expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('shows the API’s error list in a toast when the conversation is not found', async () => {
      vi.mocked(downloadExport).mockRejectedValue(new HttpError(404, { errors: ['Not found'] }, new Headers()));
      renderMenu();

      fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));

      await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Not found'));
    });

    it('shows a generic error in a toast when the failure has no API message', async () => {
      vi.mocked(downloadExport).mockRejectedValue(new HttpError(500, null, new Headers()));
      renderMenu();

      fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));

      await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Could not export the conversation. Please try again.'));
    });
  });
});
