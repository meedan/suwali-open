import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import DataSourceItemTitle from './DataSourceItemTitle';

const renderComponent = (props: React.ComponentProps<typeof DataSourceItemTitle>) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <DataSourceItemTitle {...props} />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('DataSourceItemTitle', () => {
  describe('title', () => {
    it('renders the title', () => {
      renderComponent({ title: 'My document' });
      expect(screen.getByText('My document')).toBeInTheDocument();
    });
  });

  describe('sync status', () => {
    it('shows processing when syncStatus is pending', () => {
      renderComponent({ title: 'My document', syncStatus: 'pending' });
      expect(screen.getByText(/Processing/)).toBeInTheDocument();
    });

    it('shows error when syncStatus is error', () => {
      renderComponent({ title: 'My document', syncStatus: 'error' });
      expect(screen.getByText(/Error/)).toBeInTheDocument();
    });

    it('shows paused when active is false and syncStatus is not pending', () => {
      renderComponent({ title: 'My document', active: false, syncStatus: 'complete' });
      expect(screen.getByText(/Paused/)).toBeInTheDocument();
    });

    it('shows pausing when active is false and syncStatus is pending', () => {
      renderComponent({ title: 'My document', active: false, syncStatus: 'pending' });
      expect(screen.getByText(/Pausing/)).toBeInTheDocument();
    });

    it('does not show processing when active is false and syncStatus is pending', () => {
      renderComponent({ title: 'My document', active: false, syncStatus: 'pending' });
      expect(screen.queryByText(/Processing/)).not.toBeInTheDocument();
    });

    it('shows only the icon, labelled for assistive tech, when iconOnly', () => {
      renderComponent({ title: 'My document', syncStatus: 'error', iconOnly: true });
      expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Error')).toHaveAttribute('title', 'Error');
    });

    it('shows no status prefix when syncStatus is complete and item is active', () => {
      renderComponent({ title: 'My document', syncStatus: 'complete', active: true });
      expect(screen.queryByText(/Processing|Error|Paused/)).not.toBeInTheDocument();
    });
  });

  describe('priority tier', () => {
    it('does not render the priority tier toggle when priorityTier is not provided', () => {
      renderComponent({ title: 'My document' });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows tooltip to mark as important when priorityTier is 1', () => {
      renderComponent({ title: 'My document', priorityTier: 1 });
      expect(screen.getByRole('button', { name: /mark this item as important for chatbot responses/i })).toBeInTheDocument();
    });

    it('shows tooltip to mark as default when priorityTier is 2', () => {
      renderComponent({ title: 'My document', priorityTier: 2 });
      expect(screen.getByRole('button', { name: /mark this item as default priority for chatbot responses/i })).toBeInTheDocument();
    });

    it('disables the priority tier toggle while the item is still processing', () => {
      const onTogglePriorityTier = vi.fn();
      renderComponent({ title: 'My document', priorityTier: 1, syncStatus: 'pending', onTogglePriorityTier });

      const toggle = screen.getByRole('button', { name: /mark this item as important/i });
      expect(toggle).toBeDisabled();
      fireEvent.click(toggle);
      expect(onTogglePriorityTier).not.toHaveBeenCalled();
    });

    it('calls onTogglePriorityTier when the toggle is clicked', () => {
      const onTogglePriorityTier = vi.fn();
      renderComponent({ title: 'My document', priorityTier: 1, onTogglePriorityTier });
      fireEvent.click(screen.getByRole('button', { name: /mark this item as important for chatbot responses/i }));
      expect(onTogglePriorityTier).toHaveBeenCalled();
    });
  });
});
