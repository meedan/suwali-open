import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AdminHubActivityEvent } from '@services/AdminService';

import HubActivityTimeline from './HubActivityTimeline';

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      {node}
    </IntlProvider>
  );

describe('HubActivityTimeline', () => {
  it('renders an empty state when there are no events', () => {
    renderWithProviders(<HubActivityTimeline events={[]} />);

    expect(screen.getByText('No recorded activity for this hub')).toBeInTheDocument();
  });

  it('renders a skeleton instead of the empty state while activity is still loading', () => {
    renderWithProviders(<HubActivityTimeline events={[]} pending />);

    expect(screen.queryByText('No recorded activity for this hub')).not.toBeInTheDocument();
    expect(screen.getByText('Activity timeline')).toBeInTheDocument();
  });

  it('renders a row per event with its label, detail, and actor', () => {
    const events: AdminHubActivityEvent[] = [
      { type: 'hub_created', at: '2026-06-01T00:00:00Z', actor_email: null, detail: null },
      { type: 'plan_changed', at: '2026-07-01T00:00:00Z', actor_email: 'admin@example.com', detail: 'free → standard' },
      { type: 'hub_deleted', at: '2026-08-01T00:00:00Z', actor_email: 'admin@example.com', detail: null },
    ];

    renderWithProviders(<HubActivityTimeline events={events} />);

    expect(screen.getByText('Hub created')).toBeInTheDocument();
    expect(screen.getByText('Plan changed')).toBeInTheDocument();
    expect(screen.getByText('free → standard')).toBeInTheDocument();
    expect(screen.getByText('Hub deleted')).toBeInTheDocument();
    expect(screen.getAllByText('admin@example.com').length).toBe(2);
  });

  it('renders labels for the hub-field-edit event types', () => {
    const events: AdminHubActivityEvent[] = [
      { type: 'trial_dates_changed', at: '2026-06-01T00:00:00Z', actor_email: null, detail: 'End: 2026-06-01 → 2026-06-08' },
      { type: 'custom_limits_changed', at: '2026-06-02T00:00:00Z', actor_email: null, detail: 'sources: 50 → 100' },
      { type: 'feature_flag_changed', at: '2026-06-03T00:00:00Z', actor_email: null, detail: 'MY_FEATURE: false → true' },
      { type: 'trial_emails_toggled', at: '2026-06-04T00:00:00Z', actor_email: null, detail: 'Disabled' },
    ];

    renderWithProviders(<HubActivityTimeline events={events} />);

    expect(screen.getByText('Trial dates changed')).toBeInTheDocument();
    expect(screen.getByText('End: 2026-06-01 → 2026-06-08')).toBeInTheDocument();
    expect(screen.getByText('Custom limit changed')).toBeInTheDocument();
    expect(screen.getByText('sources: 50 → 100')).toBeInTheDocument();
    expect(screen.getByText('Feature flag changed')).toBeInTheDocument();
    expect(screen.getByText('MY_FEATURE: false → true')).toBeInTheDocument();
    expect(screen.getByText('Trial emails toggled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('renders a dash for events with no detail or actor', () => {
    const events: AdminHubActivityEvent[] = [
      { type: 'hub_created', at: '2026-06-01T00:00:00Z', actor_email: null, detail: null },
    ];

    renderWithProviders(<HubActivityTimeline events={events} />);

    expect(screen.getAllByText('—').length).toBe(2);
  });
});
