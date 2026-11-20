import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import DataSourceItemActionsMenu from './DataSourceItemActionsMenu';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

const activeItem = { id: 1, active: true };
const pausedItem = { id: 1, active: false };
const pendingItem = { id: 1, active: true, sync_status: 'pending' as const };
const errorItem = { id: 1, active: true, sync_status: 'error' as const };
const completeItem = { id: 1, active: true, sync_status: 'complete' as const };

const renderMenu = (props: {
  item?: typeof activeItem | typeof pausedItem | typeof pendingItem | typeof errorItem | typeof completeItem;
  onPause?: (item: typeof activeItem) => void;
  onPreview?: (item: typeof activeItem) => void; // optional — omitting hides Preview
  onDelete?: (item: typeof activeItem) => void;
  onUnpublish?: (item: typeof activeItem) => void;
  onAddToNotebook?: (item: typeof activeItem) => void;
  onTogglePriorityTier?: (item: typeof activeItem) => void;
  onRefresh?: (item: typeof activeItem) => void;
  conversationId?: string | number;
  externalUrl?: string;
  priorityTier?: 1 | 2;
} = {}) =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <DataSourceItemActionsMenu
            item={activeItem}
            onPause={vi.fn()}
            {...props}
          />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('DataSourceItemActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dropdown contents', () => {
    it('shows Preview when onPreview is provided', () => {
      renderMenu({ onPreview: vi.fn() });
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    });

    it('does not show Preview when onPreview is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    });

    it('shows Pause label when item is active', () => {
      renderMenu();
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });

    it('shows Reactivate label when item is paused', () => {
      renderMenu({ item: pausedItem });
      expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    });

    it('shows Remove when onDelete is provided', () => {
      renderMenu({ onDelete: vi.fn() });
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    });

    it('does not show Remove when onDelete is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('does not start the menu with a separator when only Remove is available', () => {
      renderMenu({ onPause: undefined, onDelete: vi.fn() });
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    });

    it('separates Remove from the items above it', () => {
      renderMenu({ onPause: undefined, onDelete: vi.fn(), externalUrl: 'https://example.org' });
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('shows Unpublish when onUnpublish is provided', () => {
      renderMenu({ onUnpublish: vi.fn() });
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    });

    it('does not show Unpublish when onUnpublish is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument();
    });

    it('shows Include in notebooks when onAddToNotebook is provided', () => {
      renderMenu({ onAddToNotebook: vi.fn() });
      expect(screen.getAllByRole('button', { name: 'Include in notebooks' })).toHaveLength(2);
    });

    it('does not show Include in notebooks when onAddToNotebook is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Include in notebooks' })).not.toBeInTheDocument();
    });

    it('shows Show conversation when conversationId is provided', () => {
      renderMenu({ conversationId: 42 });
      expect(screen.getByRole('button', { name: 'Show conversation' })).toBeInTheDocument();
    });

    it('does not show Show conversation when conversationId is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Show conversation' })).not.toBeInTheDocument();
    });

    it('shows Open source when externalUrl is provided', () => {
      renderMenu({ externalUrl: 'https://example.com' });
      expect(screen.getByRole('button', { name: 'Open source' })).toBeInTheDocument();
    });

    it('does not show Open source when externalUrl is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument();
    });

    it('shows "Mark as important" when onTogglePriorityTier is provided and priorityTier is 1', () => {
      renderMenu({ onTogglePriorityTier: vi.fn(), priorityTier: 1 });
      expect(screen.getByRole('button', { name: 'Mark as important' })).toBeInTheDocument();
    });

    it('shows "Mark as default" when onTogglePriorityTier is provided and priorityTier is 2', () => {
      renderMenu({ onTogglePriorityTier: vi.fn(), priorityTier: 2 });
      expect(screen.getByRole('button', { name: 'Mark as default' })).toBeInTheDocument();
    });

    it('does not show priority tier item when onTogglePriorityTier is not provided', () => {
      renderMenu({ priorityTier: 1 });
      expect(screen.queryByRole('button', { name: /mark as/i })).not.toBeInTheDocument();
    });

    it('does not show priority tier item when priorityTier is not provided', () => {
      renderMenu({ onTogglePriorityTier: vi.fn() });
      expect(screen.queryByRole('button', { name: /mark as/i })).not.toBeInTheDocument();
    });

    it('disables the priority tier item while the item is still processing', () => {
      const onTogglePriorityTier = vi.fn();
      renderMenu({ item: pendingItem, onTogglePriorityTier, priorityTier: 1 });

      const button = screen.getByRole('button', { name: 'Mark as important' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onTogglePriorityTier).not.toHaveBeenCalled();
    });

    it('disables the priority tier item while the item is in error', () => {
      const onTogglePriorityTier = vi.fn();
      renderMenu({ item: errorItem, onTogglePriorityTier, priorityTier: 1 });

      const button = screen.getByRole('button', { name: 'Mark as important' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onTogglePriorityTier).not.toHaveBeenCalled();
    });

    it('shows Refresh when onRefresh is provided', () => {
      renderMenu({ onRefresh: vi.fn() });
      expect(screen.getByRole('button', { name: 'Refresh from data source' })).toBeInTheDocument();
    });

    it('does not show Refresh when onRefresh is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Refresh from data source' })).not.toBeInTheDocument();
    });
  });

  describe('quick actions', () => {
    it('always renders pause quick action button', () => {
      renderMenu();
      expect(screen.getByRole('button', { name: /pause this item/i })).toBeInTheDocument();
    });

    it('shows reactivate quick action when item is paused', () => {
      renderMenu({ item: pausedItem });
      expect(screen.getByRole('button', { name: /reactivate this item/i })).toBeInTheDocument();
    });

    it('renders notebook quick action when onAddToNotebook is provided', () => {
      renderMenu({ onAddToNotebook: vi.fn() });
      // Two "Include in notebooks" buttons: quick action + dropdown item
      expect(screen.getAllByRole('button', { name: 'Include in notebooks' })).toHaveLength(2);
    });

    it('does not render notebook quick action when onAddToNotebook is not provided', () => {
      renderMenu();
      expect(screen.queryByRole('button', { name: 'Include in notebooks' })).not.toBeInTheDocument();
    });
  });

  describe('callbacks', () => {
    it('calls onPreview with item when Preview is clicked', () => {
      const onPreview = vi.fn();
      renderMenu({ onPreview });
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(onPreview).toHaveBeenCalledWith(activeItem);
    });

    it('calls onPause with item when Pause is clicked', () => {
      const onPause = vi.fn();
      renderMenu({ onPause });
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(onPause).toHaveBeenCalledWith(activeItem);
    });

    it('calls onDelete with item when Remove is clicked', () => {
      const onDelete = vi.fn();
      renderMenu({ onDelete });
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onDelete).toHaveBeenCalledWith(activeItem);
    });

    it('calls onUnpublish with item when Unpublish is clicked', () => {
      const onUnpublish = vi.fn();
      renderMenu({ onUnpublish });
      fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
      expect(onUnpublish).toHaveBeenCalledWith(activeItem);
    });

    it('calls onAddToNotebook with item when Include in notebooks quick action is clicked', () => {
      const onAddToNotebook = vi.fn();
      renderMenu({ onAddToNotebook });
      fireEvent.click(screen.getAllByRole('button', { name: 'Include in notebooks' })[0]);
      expect(onAddToNotebook).toHaveBeenCalledWith(activeItem);
    });

    it('calls onPause with item when quick action pause button is clicked', () => {
      const onPause = vi.fn();
      renderMenu({ onPause });
      fireEvent.click(screen.getByRole('button', { name: /pause this item/i }));
      expect(onPause).toHaveBeenCalledWith(activeItem);
    });

    it.each([['pending', pendingItem], ['error', errorItem]] as const)('disables pause in the menu and the quick action while the item is %s', (_status, item) => {
      const onPause = vi.fn();
      renderMenu({ item, onPause });

      const buttons = screen.getAllByRole('button', { name: /pause/i });
      expect(buttons).toHaveLength(2);
      buttons.forEach(button => {
        expect(button).toBeDisabled();
        fireEvent.click(button);
      });
      expect(onPause).not.toHaveBeenCalled();
    });

    it.each([['pending', pendingItem], ['error', errorItem]] as const)('disables include in notebooks in the menu and the quick action while the item is %s', (_status, item) => {
      const onAddToNotebook = vi.fn();
      renderMenu({ item, onAddToNotebook });

      const buttons = screen.getAllByRole('button', { name: 'Include in notebooks' });
      expect(buttons).toHaveLength(2);
      buttons.forEach(button => {
        expect(button).toBeDisabled();
        fireEvent.click(button);
      });
      expect(onAddToNotebook).not.toHaveBeenCalled();
    });

    it('disables remove and unpublish while the item is processing, but not once it has failed', () => {
      const { unmount } = renderMenu({ item: pendingItem, onDelete: vi.fn(), onUnpublish: vi.fn() });
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeDisabled();
      unmount();

      renderMenu({ item: errorItem, onDelete: vi.fn(), onUnpublish: vi.fn() });
      expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeEnabled();
    });

    it('keeps pause enabled once the item has been processed', () => {
      renderMenu({ item: completeItem, onPause: vi.fn() });

      screen.getAllByRole('button', { name: /pause/i }).forEach(button => expect(button).toBeEnabled());
    });

    it('calls onTogglePriorityTier with item when "Mark as important" is clicked', () => {
      const onTogglePriorityTier = vi.fn();
      renderMenu({ onTogglePriorityTier, priorityTier: 1 });
      fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }));
      expect(onTogglePriorityTier).toHaveBeenCalledWith(activeItem);
    });

    it('calls onTogglePriorityTier with item when "Mark as default" is clicked', () => {
      const onTogglePriorityTier = vi.fn();
      renderMenu({ onTogglePriorityTier, priorityTier: 2 });
      fireEvent.click(screen.getByRole('button', { name: 'Mark as default' }));
      expect(onTogglePriorityTier).toHaveBeenCalledWith(activeItem);
    });

    it('calls onRefresh with item when Refresh is clicked', () => {
      const onRefresh = vi.fn();
      renderMenu({ onRefresh });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh from data source' }));
      expect(onRefresh).toHaveBeenCalledWith(activeItem);
    });
  });
});
