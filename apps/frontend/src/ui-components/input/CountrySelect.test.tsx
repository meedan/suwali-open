import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CountrySelect } from './CountrySelect';

const renderSelect = (props: Partial<React.ComponentProps<typeof CountrySelect>> = {}, wrap = (node: React.ReactNode) => node) => {
  const onValueChange = vi.fn();
  render(
    <IntlProvider locale="en" messages={{}}>
      {wrap(<CountrySelect value="BR" onValueChange={onValueChange} {...props} />)}
    </IntlProvider>
  );
  return onValueChange;
};

const trigger = () => screen.getByRole('button', { name: /^Country:/ });
const open = async () => {
  fireEvent.click(trigger());
  return screen.findByRole('textbox', { name: 'Search' });
};
const searchFor = async (value: string) => fireEvent.change(await open(), { target: { value } });
// What is outside an open modal popover, the trigger included, is hidden from the accessibility tree
const options = () => {
  const list = screen.queryByRole('list');
  return list ? within(list).getAllByRole('button') : [];
};
const names = () => options().map(button => button.textContent);

describe('CountrySelect', () => {
  it('names the country it shows, and shows its flag and dial code', () => {
    renderSelect({ value: 'FR' });

    expect(trigger()).toHaveAccessibleName('Country: France');
    expect(trigger()).toHaveTextContent('🇫🇷 +33');
  });

  it('lists the countries once opened, with the one that is chosen marked', async () => {
    renderSelect({ value: 'BR' });
    await open();

    expect(screen.getByRole('button', { name: /Brazil/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /France/ })).not.toHaveAttribute('aria-current');
    expect(options().length).toBeGreaterThan(200);
  });

  it('finds a country by any part of its name, whatever the case', async () => {
    renderSelect();
    await searchFor('ZEAL');

    expect(names()).toEqual(['🇳🇿 New Zealand+64']);
  });

  it('finds a country by its name without the accents', async () => {
    renderSelect();
    await searchFor('cote d');

    expect(names()).toEqual(['🇨🇮 Côte d’Ivoire+225']);
  });

  it('finds a country by its code', async () => {
    renderSelect();
    await searchFor('de');

    expect(names()[0]).toContain('Germany');
  });

  it('finds the countries of a dial code, with or without the +', async () => {
    renderSelect();
    await searchFor('+33');
    expect(names()).toEqual(['🇫🇷 France+33']);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '33' } });
    expect(names()).toEqual(['🇫🇷 France+33']);
  });

  it('puts the countries that start as what was typed first', async () => {
    renderSelect();
    await searchFor('ind');

    const found = names();
    expect(found[0]).toContain('India');
    expect(found[1]).toContain('Indonesia');
    expect(found.length).toBeGreaterThan(2);
  });

  it('says when no country matches', async () => {
    renderSelect();
    await searchFor('zzzz');

    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument();
    expect(options()).toHaveLength(0);
  });

  it('chooses a country by clicking it, and closes', async () => {
    const onValueChange = renderSelect();
    await searchFor('fra');
    fireEvent.click(screen.getByRole('button', { name: /France/ }));

    expect(onValueChange).toHaveBeenCalledWith('FR');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument());
  });

  it('chooses the first match with Enter, and not before anything was typed', async () => {
    const onValueChange = renderSelect();
    const search = await open();

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: 'ger' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('DE');
  });

  it('does not submit the form it is in when Enter is pressed', async () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    renderSelect({}, node => <form onSubmit={onSubmit}>{node}</form>);
    const search = await open();

    fireEvent.change(search, { target: { value: 'ger' } });
    expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
  });

  it('moves between the search and the countries with the arrow keys', async () => {
    renderSelect();
    const search = await open();
    fireEvent.change(search, { target: { value: 'ind' } });

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0], { key: 'ArrowDown' });
    expect(options()[1]).toHaveFocus();
    fireEvent.keyDown(options()[1], { key: 'ArrowUp' });
    fireEvent.keyDown(options()[0], { key: 'ArrowUp' });
    expect(search).toHaveFocus();
  });

  it('starts from an empty search each time it is opened', async () => {
    renderSelect();
    await searchFor('fra');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument());

    expect(await open()).toHaveValue('');
  });

  it('cannot be opened while disabled', () => {
    renderSelect({ disabled: true });

    expect(trigger()).toBeDisabled();
  });
});
