import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { useSession } from '@root/SessionContext';

import { useDashboardLayoutTier, useIsMobileScreen } from '@hooks/useLayout';
import type { SetupWidgetState } from '@hooks/useSetupWidgetState';
import { useSetupWidgetState } from '@hooks/useSetupWidgetState';

import DashboardMain from './DashboardMain';

vi.mock('@hooks/useLayout', () => ({
  useDashboardLayoutTier: vi.fn(),
  useIsMobileScreen: vi.fn(),
}));

vi.mock('@hooks/useSetupWidgetState', () => ({
  useSetupWidgetState: vi.fn(),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

// Radix's DropdownMenu needs real pointer events and a portal to open, neither of which happy-dom
// provides — mocked to a plain passthrough so the hidden-widgets list is always in the DOM to assert on.
vi.mock('@ui-components/input/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Layout pulls in Me/Hub/HubSettings/TopNav and their own network calls; DashboardMain's own
// composition (section order) doesn't depend on any of that, so stub it out to a plain passthrough.
vi.mock('@ui-components/layout/Layout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Left = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Main = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return { Layout };
});

// Renders an onHide callback as a button, when passed one, so hiding can be exercised from the DOM
// the same way the expanded chart stubs below expose onSendToTop. Unlike those, these widgets are
// statically imported by DashboardMain, so their mocks resolve before this file's own top-level
// consts would otherwise run — vi.hoisted keeps this stub available in time for that.
const { collapsedWidgetStub } = vi.hoisted(() => ({
  collapsedWidgetStub: (name: string) => ({ onHide }: { onHide?: () => void }) => (
    <div>
      {name}
      {onHide && <button onClick={onHide}>{`Hide ${name}`}</button>}
    </div>
  ),
}));

vi.mock('./BillingWidget', () => ({ default: collapsedWidgetStub('BillingWidget') }));
vi.mock('./ContributionsWidget', () => ({ default: collapsedWidgetStub('ContributionsWidget') }));
vi.mock('./ConversationsWidget', () => ({ default: collapsedWidgetStub('ConversationsWidget') }));
vi.mock('./PersonalizationsWidget', () => ({ default: collapsedWidgetStub('PersonalizationsWidget') }));
vi.mock('./QuestionsWidget', () => ({ default: collapsedWidgetStub('QuestionsWidget') }));
vi.mock('./SetupWidget', () => ({ default: collapsedWidgetStub('SetupWidget') }));
vi.mock('./SubscribedTopicsWidget', () => ({ default: collapsedWidgetStub('SubscribedTopicsWidget') }));
vi.mock('./TopicsWidget', () => ({ default: collapsedWidgetStub('TopicsWidget') }));

// The expanded panels are lazy-loaded and pull in recharts; stub them so a test that expands one
// resolves its import without dragging a charting library into the run. Each renders its
// onSendToTop callback as a button, when passed one, so reordering can be exercised from the DOM.
const expandedChartStub = (name: string) => ({ onSendToTop }: { onSendToTop?: () => void }) => (
  <div>
    {name}
    {onSendToTop && <button onClick={onSendToTop}>{`Send ${name} to top`}</button>}
  </div>
);

vi.mock('./ContributionsChart', () => ({ default: expandedChartStub('ContributionsChart') }));
vi.mock('./LineChart', () => ({ default: expandedChartStub('LineChart') }));
vi.mock('./QuestionsChart', () => ({ default: expandedChartStub('QuestionsChart') }));
vi.mock('./SubscribedTopicsChart', () => ({ default: expandedChartStub('SubscribedTopicsChart') }));
vi.mock('./TopicsChart', () => ({ default: expandedChartStub('TopicsChart') }));

// Only rendered on a desktop-width screen, and it drags in unrelated hub/session context.
vi.mock('@ui-components/navigation/MainPagesNav', () => ({ default: () => <div>MainPagesNav</div> }));

const setSetupWidgetState = (type: SetupWidgetState['type']) => {
  vi.mocked(useSetupWidgetState).mockReturnValue({ type } as SetupWidgetState);
};

const mockCurrentHub = (hubId: number) => {
  vi.mocked(useSession).mockReturnValue({
    user: { id: 1 },
    currentHubId: () => hubId,
  } as ReturnType<typeof useSession>);
};

// A fresh element each time: React bails out of re-rendering a subtree when handed back the very
// same element, which would make rerender() silently do nothing.
const dashboard = () => (
  <MemoryRouter>
    <IntlProvider locale="en" messages={{}}>
      <DashboardMain />
    </IntlProvider>
  </MemoryRouter>
);

const renderDashboard = ({ hubId = 1, isMobileScreen = true } = {}) => {
  vi.mocked(useDashboardLayoutTier).mockReturnValue('threeColumn');
  vi.mocked(useIsMobileScreen).mockReturnValue(isMobileScreen);
  mockCurrentHub(hubId);

  return render(dashboard());
};

const sectionTitles = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('DashboardMain', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the new hub’s expanded widgets when the hub changes, not the previous hub’s', async () => {
    setSetupWidgetState('integrations');
    localStorage.setItem('dashboardExpandedWidgets:user_1:hub_1', JSON.stringify(['conversations']));

    const { rerender } = renderDashboard({ hubId: 1, isMobileScreen: false });

    // Expanded widgets move out of the collapsed column and into a panel of their own
    expect(await screen.findByText('LineChart')).toBeInTheDocument();
    expect(screen.queryByText('ConversationsWidget')).not.toBeInTheDocument();

    mockCurrentHub(2);
    rerender(dashboard());

    expect(screen.getByText('ConversationsWidget')).toBeInTheDocument();
    expect(screen.queryByText('LineChart')).not.toBeInTheDocument();
  });

  it('shows every widget as a card on a mobile screen, where the expanded panels cannot render', () => {
    setSetupWidgetState('integrations');
    localStorage.setItem(
      'dashboardExpandedWidgets:user_1:hub_1',
      JSON.stringify(['conversations', 'contributions', 'topics', 'questions', 'subscribedTopics'])
    );

    renderDashboard({ isMobileScreen: true });

    expect(sectionTitles()).toEqual(['Activity', 'System']);
    expect(screen.getByText('ConversationsWidget')).toBeInTheDocument();
    expect(screen.getByText('TopicsWidget')).toBeInTheDocument();
    expect(screen.queryByText('LineChart')).not.toBeInTheDocument();
  });

  it('shows System status before Activity while setup is not yet connected', () => {
    setSetupWidgetState('continueSetup');

    renderDashboard();

    expect(sectionTitles()).toEqual(['System', 'Activity']);
  });

  it('shows Activity before System status once messaging is connected', () => {
    setSetupWidgetState('integrations');

    renderDashboard();

    expect(sectionTitles()).toEqual(['Activity', 'System']);
  });

  describe('reordering expanded widgets', () => {
    it('offers to send a widget to top only when another one is expanded above it', async () => {
      setSetupWidgetState('integrations');
      localStorage.setItem('dashboardExpandedWidgets:user_1:hub_1', JSON.stringify(['conversations', 'contributions']));

      renderDashboard({ isMobileScreen: false });

      expect(await screen.findByRole('button', { name: 'Send ContributionsChart to top' })).toBeInTheDocument();
      // Already first, so there is nowhere for it to go
      expect(screen.queryByRole('button', { name: 'Send LineChart to top' })).not.toBeInTheDocument();
    });

    it('does not offer to reorder when only one widget is expanded', async () => {
      setSetupWidgetState('integrations');
      localStorage.setItem('dashboardExpandedWidgets:user_1:hub_1', JSON.stringify(['conversations']));

      renderDashboard({ isMobileScreen: false });

      expect(await screen.findByText('LineChart')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send LineChart to top' })).not.toBeInTheDocument();
    });

    it('moves the clicked widget to the top of the stack and persists the new order', async () => {
      setSetupWidgetState('integrations');
      localStorage.setItem('dashboardExpandedWidgets:user_1:hub_1', JSON.stringify(['conversations', 'contributions']));

      renderDashboard({ isMobileScreen: false });

      fireEvent.click(await screen.findByRole('button', { name: 'Send ContributionsChart to top' }));

      expect(JSON.parse(localStorage.getItem('dashboardExpandedWidgets:user_1:hub_1')!)).toEqual(['contributions', 'conversations']);
      expect(screen.getByRole('button', { name: 'Send LineChart to top' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send ContributionsChart to top' })).not.toBeInTheDocument();
    });
  });

  describe('hiding widgets', () => {
    it('hides an Activity widget, persists it, and unhides it from the section indicator', () => {
      setSetupWidgetState('integrations');

      renderDashboard({ isMobileScreen: false });

      fireEvent.click(screen.getByRole('button', { name: 'Hide ConversationsWidget' }));

      expect(screen.queryByText('ConversationsWidget')).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('dashboardHiddenWidgets:user_1:hub_1')!)).toEqual(['conversations']);
      expect(screen.getByRole('button', { name: '1 hidden widget' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Conversation volume' }));

      expect(screen.getByText('ConversationsWidget')).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('dashboardHiddenWidgets:user_1:hub_1')!)).toEqual([]);
    });

    it('hides a System widget the same way as an Activity one', () => {
      setSetupWidgetState('integrations');

      renderDashboard({ isMobileScreen: false });

      fireEvent.click(screen.getByRole('button', { name: 'Hide SetupWidget' }));

      expect(screen.queryByText('SetupWidget')).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('dashboardHiddenWidgets:user_1:hub_1')!)).toEqual(['setup']);
    });

    it('does not resurrect a hidden widget as an expanded chart back on desktop', () => {
      // Mobile shows every widget collapsed regardless of its expanded state, so this widget's hide
      // button is reachable there even though it's still marked expanded underneath.
      setSetupWidgetState('integrations');
      localStorage.setItem('dashboardExpandedWidgets:user_1:hub_1', JSON.stringify(['conversations']));

      const { rerender } = renderDashboard({ isMobileScreen: true });

      fireEvent.click(screen.getByRole('button', { name: 'Hide ConversationsWidget' }));

      expect(JSON.parse(localStorage.getItem('dashboardExpandedWidgets:user_1:hub_1')!)).toEqual([]);
      expect(JSON.parse(localStorage.getItem('dashboardHiddenWidgets:user_1:hub_1')!)).toEqual(['conversations']);

      vi.mocked(useIsMobileScreen).mockReturnValue(false);
      rerender(dashboard());

      expect(screen.queryByText('LineChart')).not.toBeInTheDocument();
      expect(screen.queryByText('ConversationsWidget')).not.toBeInTheDocument();
    });
  });
});
