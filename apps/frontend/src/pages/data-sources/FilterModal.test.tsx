import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FilterModal } from './FilterModal';

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ open, onOpenChange, body, actions, trigger }: { open: boolean; onOpenChange: (open: boolean) => void; body: React.ReactNode; actions: React.ReactNode; trigger: React.ReactNode }) => (
    <>
      {trigger}
      <button onClick={() => onOpenChange(true)}>Open dialog</button>
      <button onClick={() => onOpenChange(false)}>Dismiss dialog</button>
      {open && <dialog open>{body}{actions}</dialog>}
    </>
  ),
}));

const renderModal = (open?: boolean) => {
  const handlers = { onApply: vi.fn(), onReset: vi.fn(), onDiscard: vi.fn() };
  const view = render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <FilterModal title="Filter things by" activeFiltersCount={2} open={open} verboseButton {...handlers}>
          <p>A filter</p>
        </FilterModal>
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );
  return { ...handlers, view };
};

describe('FilterModal', () => {
  it('forgets what was chosen when opened from outside, with no open change from the modal', () => {
    const { onDiscard, view } = renderModal(false);
    expect(onDiscard).not.toHaveBeenCalled();

    view.rerender(
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <FilterModal title="Filter things by" activeFiltersCount={2} open verboseButton onApply={vi.fn()} onReset={vi.fn()} onDiscard={onDiscard}>
            <p>A filter</p>
          </FilterModal>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    );

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A filter')).toBeInTheDocument();
  });

  it('forgets what was chosen and not applied each time it opens', () => {
    const { onDiscard } = renderModal();

    fireEvent.click(screen.getByText('Open dialog'));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A filter')).toBeInTheDocument();
  });

  it('forgets what was chosen when dismissed, as with Escape or a click outside', () => {
    const { onApply, onDiscard } = renderModal();
    fireEvent.click(screen.getByText('Open dialog'));
    onDiscard.mockClear();

    fireEvent.click(screen.getByText('Dismiss dialog'));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('A filter')).not.toBeInTheDocument();
  });

  it('applies without forgetting, and closes', () => {
    const { onApply, onDiscard } = renderModal();
    fireEvent.click(screen.getByText('Open dialog'));
    onDiscard.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Update filters' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByText('A filter')).not.toBeInTheDocument();
  });

  it('forgets what was chosen on cancel, and closes', () => {
    const { onApply, onDiscard } = renderModal();
    fireEvent.click(screen.getByText('Open dialog'));
    onDiscard.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('A filter')).not.toBeInTheDocument();
  });

  it('resets, and closes', () => {
    const { onReset } = renderModal();
    fireEvent.click(screen.getByText('Open dialog'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('A filter')).not.toBeInTheDocument();
  });
});
