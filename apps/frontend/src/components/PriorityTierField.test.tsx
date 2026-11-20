import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { PriorityTier } from '@customTypes/priority-tier';

import PriorityTierField from './PriorityTierField';

const renderItem = (priorityTier: PriorityTier, onToggle = vi.fn(), syncStatus?: 'pending' | 'error' | 'complete') => {
  render(
    <IntlProvider locale="en">
      <TooltipPrimitive.Provider>
        <div>
          <PriorityTierField priorityTier={priorityTier} onToggle={onToggle} syncStatus={syncStatus} />
        </div>
      </TooltipPrimitive.Provider>
    </IntlProvider>,
  );
  return onToggle;
};

describe('PriorityTierField', () => {
  it('reads default at the default tier and offers to mark it important', () => {
    renderItem(1);

    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as important' })).toBeInTheDocument();
  });

  it('reads important at the important tier and offers to mark it default', () => {
    renderItem(2);

    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as default' })).toBeInTheDocument();
  });

  it('reads default at the low tier, which the toggle treats like the default one', () => {
    renderItem(-1);

    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('toggles the priority when the button is clicked', () => {
    const onToggle = renderItem(1);

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables the change while the item is still processing, but still shows the priority', () => {
    const onToggle = renderItem(2, vi.fn(), 'pending');

    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as default' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as default' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('offers the change once the item is complete', () => {
    renderItem(1, vi.fn(), 'complete');

    expect(screen.getByRole('button', { name: 'Mark as important' })).toBeEnabled();
  });

  it('disables the change while the item is in error, but still shows the priority', () => {
    const onToggle = renderItem(2, vi.fn(), 'error');

    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as default' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as default' }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
