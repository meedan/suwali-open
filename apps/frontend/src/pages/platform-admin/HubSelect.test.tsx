import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import HubSelect from './HubSelect';

const hubs = [
  { id: 1, name: 'Acme' },
  { id: 22, name: 'São Paulo Fact Check' },
];

const renderSelect = () => {
  const onPick = vi.fn();
  render(
    <IntlProvider locale="en" messages={{}}>
      <HubSelect hubs={hubs} label="Target hub" onPick={onPick} value="" />
    </IntlProvider>
  );
  return onPick;
};

const searchFor = async (value: string) => {
  fireEvent.click(screen.getByRole('button', { name: /Target hub/ }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Search' }), { target: { value } });
};

describe('HubSelect', () => {
  it('finds a hub by its name, ignoring accents, and picks it', async () => {
    const onPick = renderSelect();
    await searchFor('sao paulo');

    const options = within(screen.getByRole('list')).getAllByRole('button');
    expect(options).toHaveLength(1);

    fireEvent.click(options[0]);
    expect(onPick).toHaveBeenCalledWith('22');
  });

  it('says so when no hub matches', async () => {
    renderSelect();
    await searchFor('nothing like this');

    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument();
  });
});
