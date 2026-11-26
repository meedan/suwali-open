import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { useState } from 'react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import TextInput from './TextInput';

const SearchField = ({ clearable = true }: { clearable?: boolean }) => {
  const [value, setValue] = useState('');
  return (
    <TextInput
      type="search"
      inputProps={{ 'aria-label': 'Search topics' }}
      value={value}
      onChange={e => setValue(e.target.value)}
      onClear={clearable ? () => setValue('') : undefined}
    />
  );
};

const renderField = (clearable?: boolean) => render(
  <IntlProvider locale="en" messages={{}}>
    <TooltipPrimitive.Provider>
      <SearchField clearable={clearable} />
    </TooltipPrimitive.Provider>
  </IntlProvider>
);

describe('TextInput search', () => {
  it('is a searchbox with no clear button until something is typed', () => {
    renderField();

    const field = screen.getByRole('searchbox', { name: 'Search topics' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'hou' } });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('empties the field and puts focus back in it when cleared', () => {
    renderField();

    const field = screen.getByRole('searchbox', { name: 'Search topics' });
    fireEvent.change(field, { target: { value: 'hou' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('has no clear button when the field does not handle clearing', () => {
    renderField(false);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search topics' }), { target: { value: 'hou' } });
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });
});
