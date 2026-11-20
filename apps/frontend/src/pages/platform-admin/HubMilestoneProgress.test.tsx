import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AdminHubActivityEvent, AdminHubDetail } from '@services/AdminService';

import HubMilestoneProgress from './HubMilestoneProgress';
import { deriveMilestones } from './hubMilestones';

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      {node}
    </IntlProvider>
  );

const mockHub = { id: 1, created_at: '2026-06-01T00:00:00Z' } as AdminHubDetail;

const event = (type: AdminHubActivityEvent['type'], at: string): AdminHubActivityEvent =>
  ({ type, at, actor_email: null, detail: null });

const planChangedEvent = (at: string, oldPlan: string, newPlan: string): AdminHubActivityEvent =>
  ({ type: 'plan_changed', at, actor_email: null, detail: `${oldPlan} → ${newPlan}`, old_plan: oldPlan, new_plan: newPlan });

describe('deriveMilestones', () => {
  it('always puts hub_created first, followed by reached milestones in real chronological order', () => {
    const events = [
      event('messaging_connected', '2026-06-05T00:00:00Z'),
      event('source_added', '2026-06-10T00:00:00Z'),
    ];

    const milestones = deriveMilestones(mockHub, events);

    expect(milestones.map((m) => m.key)).toEqual([
      'hub_created', 'messaging_connected', 'source_added', 'second_editor_joined', 'converted_to_paid',
    ]);
  });

  it('picks the earliest occurrence when an event type repeats', () => {
    const events = [
      event('source_added', '2026-06-20T00:00:00Z'),
      event('source_added', '2026-06-03T00:00:00Z'),
      event('source_removed', '2026-06-15T00:00:00Z'),
    ];

    const milestones = deriveMilestones(mockHub, events);

    expect(milestones.find((m) => m.key === 'source_added')?.at).toBe('2026-06-03T00:00:00Z');
  });

  it('uses the second-earliest membership_added event for second_editor_joined, not the creator’s own', () => {
    const events = [
      event('membership_added', '2026-06-01T00:05:00Z'),
      event('membership_added', '2026-06-08T00:00:00Z'),
    ];

    const milestones = deriveMilestones(mockHub, events);

    expect(milestones.find((m) => m.key === 'second_editor_joined')?.at).toBe('2026-06-08T00:00:00Z');
  });

  it('leaves unreached milestones with a null timestamp, grouped after the reached ones', () => {
    const milestones = deriveMilestones(mockHub, []);

    expect(milestones.map((m) => m.key)).toEqual([
      'hub_created', 'source_added', 'second_editor_joined', 'messaging_connected', 'converted_to_paid',
    ]);
    expect(milestones.slice(1).every((m) => m.at === null)).toBe(true);
  });

  it('derives converted_to_paid from a plan_changed event that moves off a free plan', () => {
    const events = [planChangedEvent('2026-06-10T00:00:00Z', 'free', 'standard')];

    const milestones = deriveMilestones(mockHub, events);

    expect(milestones.find((m) => m.key === 'converted_to_paid')?.at).toBe('2026-06-10T00:00:00Z');
  });

  it('ignores plan_changed events that are not a free-to-paid transition', () => {
    const events = [
      planChangedEvent('2026-06-10T00:00:00Z', 'free', 'free_unrestricted'),
      planChangedEvent('2026-06-15T00:00:00Z', 'standard', 'pro'),
    ];

    const milestones = deriveMilestones(mockHub, events);

    expect(milestones.find((m) => m.key === 'converted_to_paid')?.at).toBeNull();
  });
});

describe('HubMilestoneProgress', () => {
  it('renders both the day-count phrase and the exact timestamp for a reached milestone', () => {
    const events = [event('source_added', '2026-06-04T15:30:00Z')];

    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={events} />);

    expect(screen.getByText('Data source added')).toBeInTheDocument();
    expect(screen.getByText('3 days after creation')).toBeInTheDocument();
    expect(screen.getByText(/Jun 4, 2026/)).toBeInTheDocument();
  });

  it('renders "Same day" for a milestone reached the same day as creation, alongside its timestamp', () => {
    const events = [event('source_added', '2026-06-01T12:00:00Z')];

    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={events} />);

    expect(screen.getByText('Same day')).toBeInTheDocument();
    // Both hub_created and the same-day source_added render a "Jun 1, 2026" timestamp.
    expect(screen.getAllByText(/Jun 1, 2026/).length).toBe(2);
  });

  it('renders the hub_created milestone with its own timestamp, including the time', () => {
    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={[]} />);

    expect(screen.getByText('Hub created')).toBeInTheDocument();
    expect(screen.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });

  it('renders "Not yet" for a milestone that has not been reached', () => {
    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={[]} />);

    expect(screen.getAllByText('Not yet').length).toBe(4);
  });

  it('renders nothing while activity is still loading, rather than reporting every milestone as missed', () => {
    const { container } = renderWithProviders(<HubMilestoneProgress hub={mockHub} events={[]} pending />);

    expect(screen.queryByText('Not yet')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the converted_to_paid milestone as reached when the hub has moved off a free plan', () => {
    const events = [planChangedEvent('2026-06-10T00:00:00Z', 'free', 'standard')];

    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={events} />);

    expect(screen.getByText('Converted to paid')).toBeInTheDocument();
    expect(screen.getByText('9 days after creation')).toBeInTheDocument();
  });

  it('uses the check icon for reached milestones and the “worth checking” icon for unreached ones', () => {
    const events = [event('source_added', '2026-06-04T00:00:00Z')];

    renderWithProviders(<HubMilestoneProgress hub={mockHub} events={events} />);

    const iconHref = (label: string) =>
      screen.getByText(label).closest('li')?.querySelector('use')?.getAttribute('href');

    expect(iconHref('Hub created')).toContain('check_filled');
    expect(iconHref('Data source added')).toContain('check_filled');
    expect(iconHref('Second editor joined')).toContain('countdown_filled');
    expect(iconHref('Messaging connected')).toContain('countdown_filled');
  });
});
