import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { setLastPath } from '@helpers/lastPath';

import * as SessionContext from '@root/SessionContext';

import ConversationTypeSelector from './ConversationTypeSelector';

vi.mock('../SessionContext', () => ({
  useSession: vi.fn(),
}));

vi.mocked(SessionContext.useSession).mockReturnValue({
  currentHub: () => ({ name: 'Suwali', profile_picture_url: '' }),
  currentHubId: () => 1,
  user: { name: 'Ada Lovelace', email: 'ada@example.com', profile_picture_url: '' },
} as unknown as ReturnType<typeof SessionContext.useSession>);

const LocationKey = () => <output aria-label="Location key">{useLocation().key}</output>;

const CurrentUrl = () => {
  const location = useLocation();
  return <output aria-label="Current URL">{location.pathname}{location.search}</output>;
};

const renderComponent = (from = 'audience') =>
  render(
    <MemoryRouter initialEntries={[`/conversations/${from}`]}>
      <IntlProvider locale="en" messages={{}}>
        <Routes>
          <Route
            path="/conversations/:from"
            element={<><ConversationTypeSelector /><LocationKey /></>}
          />
          <Route path="*" element={<CurrentUrl />} />
        </Routes>
      </IntlProvider>
    </MemoryRouter>
  );

describe('ConversationTypeSelector', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows a toggle for each conversation type, checking the selected one', () => {
    renderComponent('team');

    expect(screen.getByRole('radio', { name: 'Audience' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Team/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /You/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('does not navigate when the selected type is clicked again', () => {
    renderComponent('me');

    const locationKey = screen.getByRole('status', { name: 'Location key' }).textContent;
    fireEvent.click(screen.getByRole('radio', { name: /You/ }));

    expect(screen.getByRole('status', { name: 'Location key' })).toHaveTextContent(locationKey!);
  });

  it('goes straight to the last path of the selected type, keeping its filters', () => {
    setLastPath('conversationsLastPath:audience', 1, '/conversations/audience/42?platforms=telegram');
    renderComponent('me');

    fireEvent.click(screen.getByRole('radio', { name: 'Audience' }));

    expect(screen.getByRole('status', { name: 'Current URL' })).toHaveTextContent(/\/conversations\/audience\/42\?platforms=telegram$/);
  });
});
