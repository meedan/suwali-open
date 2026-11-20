import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import StatusField from './StatusField';

type Props = React.ComponentProps<typeof StatusField>;

const renderItem = ({ active = true, syncStatus = 'complete', onToggle = vi.fn(), onRetry }: Partial<Props> = {}) => {
  render(
    <IntlProvider locale="en">
      <TooltipPrimitive.Provider>
        <div>
          <StatusField active={active} syncStatus={syncStatus} onToggle={onToggle} onRetry={onRetry} />
        </div>
      </TooltipPrimitive.Provider>
    </IntlProvider>,
  );
  return onToggle;
};

describe('StatusField', () => {
  it('reads active and offers to pause the item', () => {
    renderItem();

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('reads paused and offers to reactivate the item', () => {
    renderItem({ active: false });

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('asks to toggle when the button is clicked', () => {
    const onToggle = renderItem();

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('still says what state an item is in when it cannot be paused, and disables the button', () => {
    const onToggle = renderItem({ syncStatus: 'error' });

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('offers a retry in place of the pause for an item in error', () => {
    const onRetry = vi.fn();
    const onToggle = renderItem({ syncStatus: 'error', onRetry });

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('offers no retry for an item that is not in error', () => {
    renderItem({ syncStatus: 'complete', onRetry: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('reads processing for an item still being processed, and disables the button', () => {
    renderItem({ syncStatus: 'pending' });
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('reads pausing for a paused item that is still being processed', () => {
    renderItem({ syncStatus: 'pending', active: false });

    expect(screen.getByText('Pausing')).toBeInTheDocument();
  });

  it('offers no button where nothing handles pausing', () => {
    render(
      <IntlProvider locale="en">
        <TooltipPrimitive.Provider>
          <StatusField active syncStatus="complete" />
        </TooltipPrimitive.Provider>
      </IntlProvider>,
    );

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
