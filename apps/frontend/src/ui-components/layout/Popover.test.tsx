import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Popover, PopoverContent, PopoverTrigger } from './Popover';

const Test = ({ holdSide = true, side }: { holdSide?: boolean; side: 'top' | 'bottom' }) => (
  <Popover>
    <PopoverTrigger>Open</PopoverTrigger>
    <PopoverContent holdSide={holdSide} side={side}>
      <input aria-label="Search" />
    </PopoverContent>
  </Popover>
);

const search = () => screen.getByRole('textbox', { name: 'Search' });
const placedOn = () => search().parentElement?.getAttribute('data-side');
// The popover works out which side it is on after it has rendered
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('textbox', { name: 'Search' });
};

describe('PopoverContent holding its side', () => {
  it('keeps the side it was on once something is typed, even when another has room', async () => {
    const { rerender } = render(<Test side="top" />);
    await open();
    fireEvent.input(search(), { target: { value: 'a' } });

    rerender(<Test side="bottom" />);
    await settle();

    expect(placedOn()).toBe('top');
  });

  it('puts itself on the side with room for as long as nothing is typed', async () => {
    const { rerender } = render(<Test side="top" />);
    await open();

    rerender(<Test side="bottom" />);
    await settle();

    expect(placedOn()).toBe('bottom');
  });

  it('starts over each time it is opened', async () => {
    const { rerender } = render(<Test side="top" />);
    await open();
    fireEvent.input(search(), { target: { value: 'a' } });
    fireEvent.keyDown(search(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument());

    rerender(<Test side="bottom" />);
    await open();
    await settle();

    expect(placedOn()).toBe('bottom');
  });

  it('does nothing unless asked to', async () => {
    const { rerender } = render(<Test holdSide={false} side="top" />);
    await open();
    fireEvent.input(search(), { target: { value: 'a' } });

    rerender(<Test holdSide={false} side="bottom" />);
    await settle();

    expect(placedOn()).toBe('bottom');
  });
});
