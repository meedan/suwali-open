import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import DensityToggle from './DensityToggle';

const renderToggle = (value: 'compact' | 'comfortable', onChange = vi.fn()) => {
  render(
    <IntlProvider locale="en">
      <TooltipPrimitive.Provider>
        <DensityToggle value={value} onChange={onChange} />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );
  return onChange;
};

describe('DensityToggle', () => {
  it('marks the current density as selected', () => {
    renderToggle('comfortable');
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Compact' })).not.toBeChecked();
  });

  // The selected button is highlighted through data-state, which the tooltip must not take over
  it('keeps the selected button marked for its highlight', () => {
    renderToggle('comfortable');
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('data-state', 'off');
  });

  it('reports the density the user picks', () => {
    const onChange = renderToggle('compact');
    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(onChange).toHaveBeenCalledWith('comfortable');
  });

  it('explains each density in a tooltip', async () => {
    renderToggle('compact');
    fireEvent.focus(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Comfortable display density');
  });

  it('keeps the current density when its button is clicked again', () => {
    const onChange = renderToggle('compact');
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
