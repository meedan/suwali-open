import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import * as SessionContext from '@root/SessionContext';
import { buildHub } from '@root/test/fixtures/hub';

import TrialDaysRemainingBanner from './TrialDaysRemainingBanner';

const trialHub = buildHub({
  name: 'Suwali',
  trial_started_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  trial_ends_at: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000).toISOString(),
});

vi.mock('../SessionContext', () => ({
  useSession: vi.fn(),
}));


const renderComponent = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TrialDaysRemainingBanner />
      </IntlProvider>
    </MemoryRouter>
  );

describe('TrialDaysRemainingBanner', () => {
  it('returns null for an enterprise hub', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => ({ ...trialHub, plan: 'enterprise' }),
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);

    const { container } = renderComponent();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner for a hub on a free trial', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => trialHub,
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);

    renderComponent();
    expect(screen.getByText(/upgrade to the full experience/i)).toBeInTheDocument();
  });
});
