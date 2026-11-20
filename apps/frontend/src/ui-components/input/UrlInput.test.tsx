import { useState } from 'react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import UrlInput from './UrlInput';

const Harness = ({ initial = '', error }: { initial?: string; error?: string }) => {
  const [value, setValue] = useState(initial);
  return <UrlInput id="address" label="Address" value={value} onChange={setValue} error={error} />;
};

const renderInput = (props: React.ComponentProps<typeof Harness> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <Harness {...props} />
    </IntlProvider>
  );

const input = () => screen.getByRole('textbox', { name: 'Address' });
const type = (value: string) => fireEvent.change(input(), { target: { value } });

describe('UrlInput', () => {
  it('adds https:// to the address when the field is left', () => {
    renderInput();

    type('help.example.com');
    expect(input()).toHaveValue('help.example.com');

    fireEvent.blur(input());
    expect(input()).toHaveValue('https://help.example.com');
  });

  it('says an address is invalid only once the field is left, and stops as soon as it is right', () => {
    renderInput();

    type('asdf');
    expect(screen.queryByText('Invalid URL')).not.toBeInTheDocument();

    fireEvent.blur(input());
    expect(screen.getByText('Invalid URL')).toBeInTheDocument();

    type('asdf.com');
    expect(screen.queryByText('Invalid URL')).not.toBeInTheDocument();
  });

  it('says nothing about an empty field', () => {
    renderInput();

    fireEvent.blur(input());

    expect(screen.queryByText('Invalid URL')).not.toBeInTheDocument();
  });

  it('shows another error while the address is fine', () => {
    renderInput({ initial: 'https://example.com', error: 'Could not be reached' });

    expect(screen.getByText('Could not be reached')).toBeInTheDocument();
  });
});
