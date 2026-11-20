import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import Chip from './Chip';

vi.mock('@ui-components/layout/Icon', () => ({
  default: () => null,
}));

describe('Chip', () => {
  it('shows what it labels, with nothing to remove unless it can be', () => {
    render(<Chip>Elections</Chip>);

    expect(screen.getByText('Elections')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes itself from a button named for what it removes', () => {
    const onRemove = vi.fn();
    render(<Chip removeLabel="Remove topic Elections" onRemove={onRemove}>Elections</Chip>);

    fireEvent.click(screen.getByRole('button', { name: 'Remove topic Elections' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('can be clicked from its label, apart from the button that removes it', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Chip removeLabel="Remove" onClick={onClick} onRemove={onRemove}>Elections</Chip>);

    fireEvent.click(screen.getByRole('button', { name: 'Elections' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('explains what clicking its label does, when it is focused', async () => {
    render(
      <TooltipPrimitive.Provider>
        <Chip clickLabel="Filter by Elections" clickTooltip="Filter by Elections" onClick={vi.fn()}>Elections</Chip>
      </TooltipPrimitive.Provider>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Filter by Elections' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Filter by Elections');
  });
});
