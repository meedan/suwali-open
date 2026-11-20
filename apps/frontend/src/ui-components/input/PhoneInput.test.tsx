import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PhoneInput from './PhoneInput';

const renderInput = (props: Partial<React.ComponentProps<typeof PhoneInput>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <PhoneInput label="Phone number" value="" country="BR" onChange={vi.fn()} onCountryChange={vi.fn()} {...props} />
    </IntlProvider>
  );

describe('PhoneInput', () => {
  it('has one label for the number, and a country button named for the country it shows', () => {
    renderInput();

    expect(screen.getByRole('textbox', { name: 'Phone number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Country: Brazil' })).toBeInTheDocument();
  });

  it('shows the country’s flag and dial code when the list is closed', () => {
    renderInput({ country: 'BR' });

    expect(screen.getByRole('button', { name: 'Country: Brazil' })).toHaveTextContent('🇧🇷 +55');
  });

  it('changes the country by searching the list', async () => {
    const onCountryChange = vi.fn();
    renderInput({ onCountryChange });

    fireEvent.click(screen.getByRole('button', { name: 'Country: Brazil' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search' }), { target: { value: 'fra' } });
    fireEvent.click(screen.getByRole('button', { name: /France/ }));

    expect(onCountryChange).toHaveBeenCalledWith('FR');
  });

  it('passes on what is typed, as typed', () => {
    const onChange = vi.fn();
    renderInput({ onChange });

    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '(11) 98765-4321' } });

    expect(onChange).toHaveBeenCalledWith('(11) 98765-4321');
  });

  it('can leave the country out and keep the same field', () => {
    renderInput({ hideCountry: true });

    expect(screen.queryByRole('button', { name: /^Country:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toBeInTheDocument();
  });

  it('shows the help and the error under the whole row, as the label is over it, and not inside the number’s column', () => {
    renderInput({ helpContent: 'Without the country code.', error: 'Not a number' });

    const row = screen.getByRole('textbox', { name: 'Phone number' }).closest('[class*="_number_"]')?.parentElement as HTMLElement;
    const wrapper = row.parentElement as HTMLElement;

    for (const text of ['Without the country code.', 'Not a number']) {
      const element = screen.getByText(text);
      expect(row).not.toContainElement(element);
      expect(wrapper).toContainElement(element);
    }
  });
});
