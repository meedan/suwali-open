import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Hub } from '@customTypes/hub';

import * as SessionContext from '@root/SessionContext';
import { buildHub } from '@root/test/fixtures/hub';

import BillingWidget from './BillingWidget';

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

const testHub = buildHub({
  external_data_sources_count: 3,
  documents_count: 10,
  monthly_messages_count: 900,
  max_sources_for_plan: 3,
  trial_ends_at: '2026-08-23T00:00:00Z',
});

const mockHub = (hub: Hub | null) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHub: () => hub,
    currentHubId: () => hub?.id ?? null,
  } as ReturnType<typeof SessionContext.useSession>);
};

const renderComponent = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <BillingWidget />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('BillingWidget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when hub is null', () => {
    mockHub(null);

    const { container } = renderComponent();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the trial end date, plan name and usage for every limited row', () => {
    mockHub(testHub);

    renderComponent();
    expect(screen.getByText(/Ends August 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Free trial!')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('1,000 per month')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('100 included')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('3 included')).toBeInTheDocument();
  });

  it('renders the current month and the reset date for paid plans', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    mockHub({ ...testHub, plan: 'pro' });

    renderComponent();
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Sep 1, 2026')).toBeInTheDocument();
  });

  it('explains the consequence of a reached limit in the tooltip', async () => {
    mockHub(testHub);

    renderComponent();
    fireEvent.focus(screen.getByText('Data sources').closest('[data-state]')!);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('You have reached your limit of connected data sources');
    expect(tooltip).toHaveTextContent('You will not be able to connect additional data sources');
  });

  it('shows plain usage in the tooltip when below the limit', async () => {
    mockHub(testHub);

    renderComponent();
    fireEvent.focus(screen.getByText('Documents').closest('[data-state]')!);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('10 documents added out of 100 included in your plan');
  });

  it('keeps the tooltip bullets out until the limit is reached', async () => {
    mockHub(testHub);

    renderComponent();
    fireEvent.focus(screen.getByText('Messages').closest('[data-state]')!);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('900 messages sent out of 1,000 included in your plan');
    expect(tooltip.querySelector('li')).toBeNull();
  });

  it('renders rows whose plan has no limit as unrestricted', () => {
    mockHub({
      ...testHub,
      plan: 'enterprise',
      monthly_messages_count: 3345,
      documents_count: 1000,
      external_data_sources_count: 8,
      max_sources_for_plan: null,
      max_documents_for_plan: null,
      max_messages_for_plan: null,
    });

    renderComponent();
    expect(screen.getAllByText('Unrestricted')).toHaveLength(3);
    expect(screen.getByText('3,345')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
