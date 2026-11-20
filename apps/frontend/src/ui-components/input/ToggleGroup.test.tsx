import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToggleGroup, ToggleGroupItem } from './ToggleGroup';

const renderGroup = (onValueChange = vi.fn()) => {
  render(
    <IntlProvider locale="en" messages={{}}>
      <ToggleGroup type="single" value="asc" onValueChange={onValueChange} aria-label="Sort direction">
        <ToggleGroupItem value="asc" iconLeft={<svg aria-label="Ascending icon" />}>
          Ascending
        </ToggleGroupItem>
        <ToggleGroupItem value="desc">
          Descending
        </ToggleGroupItem>
      </ToggleGroup>
    </IntlProvider>
  );
  return onValueChange;
};

describe('ToggleGroup', () => {
  it('renders the left icon before the item’s label', () => {
    renderGroup();

    const item = screen.getByRole('radio', { name: /Ascending/ });
    expect(item.firstElementChild).toContainElement(screen.getByLabelText('Ascending icon'));
    expect(item).toHaveTextContent('Ascending');
  });

  it('renders an item without an icon as just its label', () => {
    renderGroup();

    expect(screen.getByRole('radio', { name: 'Descending' }).children).toHaveLength(0);
  });

  it('still behaves as a single-choice group', () => {
    const onValueChange = renderGroup();

    expect(screen.getByRole('radio', { name: /Ascending/ })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Descending' }));
    expect(onValueChange).toHaveBeenCalledWith('desc');
  });

  it('keeps Radix’s group and radio roles by default', () => {
    renderGroup();

    expect(screen.getByRole('group', { name: 'Sort direction' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('takes menu roles for the menu variant, keeping the checked item', () => {
    render(
      <ToggleGroup type="single" value="profile" variant="menu" aria-label="Settings menu">
        <ToggleGroupItem value="profile">Profile</ToggleGroupItem>
        <ToggleGroupItem value="language">Language</ToggleGroupItem>
      </ToggleGroup>
    );

    expect(screen.getByRole('menu', { name: 'Settings menu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Profile' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Language' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
