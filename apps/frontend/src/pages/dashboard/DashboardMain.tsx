import clsx from 'clsx';
import { lazy, Suspense, useState } from 'react';
import { FormattedMessage } from 'react-intl';

import { useSession } from '@root/SessionContext';
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { useDashboardLayoutTier, useIsMobileScreen } from '@hooks/useLayout';
import usePageTitle from '@hooks/usePageTitle';
import { useSetupWidgetState } from '@hooks/useSetupWidgetState';

import { Layout } from '@ui-components/layout/Layout';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';
import MainPagesNav from '@ui-components/navigation/MainPagesNav';

import Fallback from '@layouts/error/Fallback';

import BillingWidget from './BillingWidget';
import ContributionsWidget from './ContributionsWidget';
import ConversationsWidget from './ConversationsWidget';
import styles from './DashboardMain.module.css';
import HiddenWidgetsIndicator from './HiddenWidgetsIndicator';
import PersonalizationsWidget from './PersonalizationsWidget';
import QuestionsWidget from './QuestionsWidget';
import SetupWidget from './SetupWidget';
import SubscribedTopicsWidget from './SubscribedTopicsWidget';
import TopicsWidget from './TopicsWidget';

const ContributionsChart = lazy(() => import('./ContributionsChart'));
const LineChart = lazy(() => import('./LineChart'));
const TopicsChart = lazy(() => import('./TopicsChart'));
const QuestionsChart = lazy(() => import('./QuestionsChart'));
const SubscribedTopicsChart = lazy(() => import('./SubscribedTopicsChart'));

const EXPANSIBLE_WIDGETS = ['conversations', 'contributions', 'topics', 'questions', 'subscribedTopics'] as const;
type expansible = (typeof EXPANSIBLE_WIDGETS)[number];

const COLLAPSED_WIDGETS: Record<expansible, React.ComponentType<{ onExpand?: () => void; onHide?: () => void }>> = {
  contributions: ContributionsWidget,
  conversations: ConversationsWidget,
  questions: QuestionsWidget,
  subscribedTopics: SubscribedTopicsWidget,
  topics: TopicsWidget,
};

const EXPANDED_CHARTS: Record<expansible, React.ComponentType<{ onClose?: () => void; onSendToTop?: () => void }>> = {
  contributions: ContributionsChart,
  conversations: LineChart,
  questions: QuestionsChart,
  subscribedTopics: SubscribedTopicsChart,
  topics: TopicsChart,
};

type layoutTier = 'oneColumn' | 'twoColumn' | 'threeColumn';

const WIDGET_ORDER: Record<layoutTier, expansible[]> = {
  threeColumn: ['conversations', 'topics', 'questions', 'subscribedTopics', 'contributions'],
  twoColumn: ['conversations', 'topics', 'contributions', 'questions', 'subscribedTopics'],
  oneColumn: ['conversations', 'questions', 'topics', 'subscribedTopics', 'contributions'],
};

const SYSTEM_WIDGETS = ['setup', 'personalizations', 'billing'] as const;
type systemWidget = (typeof SYSTEM_WIDGETS)[number];
type widgetId = expansible | systemWidget;
const HIDEABLE_WIDGETS: widgetId[] = [...EXPANSIBLE_WIDGETS, ...SYSTEM_WIDGETS];

const SYSTEM_WIDGET_COMPONENTS: Record<systemWidget, React.ComponentType<{ onHide?: () => void }>> = {
  setup: SetupWidget,
  personalizations: PersonalizationsWidget,
  billing: BillingWidget,
};

// Reuses each widget's own title message verbatim, so the unhide list never introduces a second
// translation for the same concept
const WIDGET_LABELS: Record<widgetId, React.ReactNode> = {
  conversations: (
    <FormattedMessage
      id="global.conversationVolume"
      defaultMessage="Conversation volume"
      description="Reusable label for the amount of conversations over a given period"
    />
  ),
  contributions: (
    <FormattedMessage
      id="global.communityContributions"
      defaultMessage="Community contributions"
      description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
    />
  ),
  questions: (
    <FormattedMessage
      id="global.answerRate"
      defaultMessage="Answer rate"
      description="Reusable label for how much of what the audience asked the chatbot could answer"
    />
  ),
  subscribedTopics: (
    <FormattedMessage
      id="global.subscribedTopics"
      defaultMessage="Subscribed topics"
      description="Reusable label for the topics your audience has subscribed to for updates"
    />
  ),
  topics: (
    <FormattedMessage
      id="global.conversationTopics"
      defaultMessage="Conversation topics"
      description="Reusable label for the topics your audience asks about"
    />
  ),
  setup: (
    <FormattedMessage
      id="global.messagingPlatforms"
      defaultMessage="Messaging platforms"
      description="Reusable label for the list of messaging platforms connected to the hub"
    />
  ),
  personalizations: (
    <FormattedMessage
      id="global.personalizations"
      defaultMessage="Personalizations"
      description="Title for personalization/bot identity settings"
    />
  ),
  billing: (
    <FormattedMessage
      id="global.billingPlan"
      defaultMessage="Billing plan"
      description="Title or caption for the subscription billing plan"
    />
  ),
};

const buildStorageKey = (userId?: number, hubId?: number | null) => `dashboardExpandedWidgets:user_${userId}:hub_${hubId}`;
const buildHiddenStorageKey = (userId?: number, hubId?: number | null) => `dashboardHiddenWidgets:user_${userId}:hub_${hubId}`;

const getIdsFromLocalStorage = <T extends string>(storageKey: string, validIds: readonly T[]): T[] => {
  let ids: T[] = [];

  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      ids = JSON.parse(stored).filter((id: T) => validIds.includes(id));
    } catch {
      ids = [];
    }
  }

  return ids;
};

const setIdsToLocalStorage = <T extends string>(storageKey: string, ids: T[], validIds: readonly T[]): T[] => {
  localStorage.setItem(storageKey, JSON.stringify(ids.filter(id => validIds.includes(id))));
  return ids;
};

const getExpandedFromLocalStorage = (storageKey: string) => getIdsFromLocalStorage(storageKey, EXPANSIBLE_WIDGETS);
const setExpandedToLocalStorage = (storageKey: string, expanded: expansible[]) => setIdsToLocalStorage(storageKey, expanded, EXPANSIBLE_WIDGETS);
const getHiddenFromLocalStorage = (storageKey: string) => getIdsFromLocalStorage(storageKey, HIDEABLE_WIDGETS);
const setHiddenToLocalStorage = (storageKey: string, hidden: widgetId[]) => setIdsToLocalStorage(storageKey, hidden, HIDEABLE_WIDGETS);

const DashboardMain = () => {
  usePageTitle(
    <FormattedMessage
      id="global.dashboardPageTitle"
      defaultMessage="Dashboard"
      description="Browser Page title for the dashboard main page"
    />
  );

  const isMobileScreen = useIsMobileScreen();
  const layoutTier = useDashboardLayoutTier();
  const session = useSession();
  const userId = session.user?.id;
  const hubId = session.currentHubId();
  const storageKey = buildStorageKey(userId, hubId);
  const hiddenStorageKey = buildHiddenStorageKey(userId, hubId);

  const [expanded, setExpanded] = useState<expansible[]>(() => getExpandedFromLocalStorage(storageKey));
  const [hiddenWidgets, setHiddenWidgets] = useState<widgetId[]>(() => getHiddenFromLocalStorage(hiddenStorageKey));
  const [loadedKey, setLoadedKey] = useState(storageKey);

  // Switching hubs navigates to the same route with a different param, so this component is reused
  // rather than remounted and the initializer above never runs again. Without re-reading here, the
  // previous hub's expanded widgets stay on screen and get written over the new hub's own state.
  if (loadedKey !== storageKey) {
    setLoadedKey(storageKey);
    setExpanded(getExpandedFromLocalStorage(storageKey));
    setHiddenWidgets(getHiddenFromLocalStorage(hiddenStorageKey));
  }

  const handleExpandWidget = (widgetId: expansible) => setExpanded((prev) => setExpandedToLocalStorage(storageKey, [...prev, widgetId]));
  const handleCollapseWidget = (widgetId: expansible) => setExpanded((prev) => setExpandedToLocalStorage(storageKey, prev.filter(e => e !== widgetId)));
  const handleSendWidgetToTop = (widgetId: expansible) => setExpanded((prev) => setExpandedToLocalStorage(storageKey, [widgetId, ...prev.filter(e => e !== widgetId)]));
  const handleHideWidget = (id: widgetId) => {
    setHiddenWidgets((prev) => setHiddenToLocalStorage(hiddenStorageKey, [...prev, id]));
    // On mobile every widget renders collapsed regardless of its expanded state, so hiding one there
    // can target a widget that's still marked expanded underneath. Clearing it here keeps hidden and
    // expanded disjoint instead of having a hidden widget reappear as a full chart back on desktop.
    setExpanded((prev) => setExpandedToLocalStorage(storageKey, prev.filter(e => e !== id)));
  };
  const handleUnhideWidget = (id: widgetId) => setHiddenWidgets((prev) => setHiddenToLocalStorage(hiddenStorageKey, prev.filter(w => w !== id)));

  // Expanding is a desktop-only affordance and the panels need a width a phone does not have, so a
  // small screen shows every widget as a card whatever was expanded on a bigger one. What is stored
  // is deliberately left alone, so going back to a desktop restores the layout the reader left.
  const expandedOnScreen = isMobileScreen ? [] : expanded;

  const renderCollapsedWidget = (id: expansible) => {
    if (expandedOnScreen.includes(id) || hiddenWidgets.includes(id)) return null;
    const CollapsedWidget = COLLAPSED_WIDGETS[id];

    return (
      <CollapsedWidget
        key={id}
        onExpand={isMobileScreen ? undefined : () => handleExpandWidget(id)}
        onHide={() => handleHideWidget(id)}
      />
    );
  };

  const renderSystemWidget = (id: systemWidget) => {
    if (hiddenWidgets.includes(id)) return null;
    const SystemWidget = SYSTEM_WIDGET_COMPONENTS[id];

    return (
      <SuwaliErrorBoundary key={id} fallback={<Fallback actions={['tryAgain']} />}>
        <SystemWidget key={id} onHide={() => handleHideWidget(id)} />
      </SuwaliErrorBoundary>
    );
  };

  const renderExpandedWidget = (id: expansible, index: number) => {
    const Chart = EXPANDED_CHARTS[id];
    // Already at the front of the stack, so there is nowhere for it to go
    const canSendToTop = expandedOnScreen.length > 1 && index > 0;

    return (
      <SuwaliErrorBoundary key={id} fallback={<Fallback actions={['tryAgain']} />}>
        <Suspense fallback={<PanelLoading className={styles.expandedWidgetLoadingIndicator} />}>
          <Chart
            onClose={() => handleCollapseWidget(id)}
            onSendToTop={canSendToTop ? () => handleSendWidgetToTop(id) : undefined}
          />
        </Suspense>
      </SuwaliErrorBoundary>
    );
  };

  const setupWidgetState = useSetupWidgetState();
  const isSetupConnected = setupWidgetState.type === 'integrations';

  const widgetOrder = WIDGET_ORDER[layoutTier];

  const activityHidden = hiddenWidgets.filter((id): id is expansible => (EXPANSIBLE_WIDGETS as readonly string[]).includes(id));
  const systemHidden = hiddenWidgets.filter((id): id is systemWidget => (SYSTEM_WIDGETS as readonly string[]).includes(id));

  const activitySection = (expandedOnScreen.length < EXPANSIBLE_WIDGETS.length) && (
    <div className={styles.widgetsSection} key="activity">
      <div className={styles.widgetsSectionHeader}>
        <FormattedMessage
          id="global.activity"
          defaultMessage="Activity"
          description="Generic label for activity and outcomes"
          tagName="h2"
        />
        <HiddenWidgetsIndicator hiddenIds={activityHidden} labels={WIDGET_LABELS} onUnhide={handleUnhideWidget} />
      </div>
      <div className={styles.widgetsColumns}>
        {widgetOrder.map(renderCollapsedWidget)}
      </div>
    </div>
  );

  const systemStatusSection = (
    <div className={styles.widgetsSection} key="systemStatus">
      <div className={styles.widgetsSectionHeader}>
        <FormattedMessage
          id="global.system"
          defaultMessage="System"
          description="Heading or label showing hub configuration and system status"
          tagName="h2"
        />
        <HiddenWidgetsIndicator hiddenIds={systemHidden} labels={WIDGET_LABELS} onUnhide={handleUnhideWidget} />
      </div>
      <div className={styles.widgetsColumns}>
        {SYSTEM_WIDGETS.map(renderSystemWidget)}
      </div>
    </div>
  );

  return (
    <Layout>
      {!isMobileScreen &&
        <Layout.Left homePage>
          <MainPagesNav homePage />
        </Layout.Left>
      }
      <Layout.Main
        name={
          <FormattedMessage
            id="global.dashboardPageTitle"
            defaultMessage="Dashboard"
            description="Browser Page title for the dashboard main page"
          />
        }
      >
        <div className={clsx('layout-main-column-scrollable-area', styles.dashboardWrapper)}>
          {expandedOnScreen.length > 0 && (
            <div className={styles.expandedWrapper}>
              {expandedOnScreen.map(renderExpandedWidget)}
            </div>
          )}
          <div className={styles.widgetsWrapper}>
            {isSetupConnected
              ? [activitySection, systemStatusSection]
              : [systemStatusSection, activitySection]}
          </div>
        </div>
      </Layout.Main>
    </Layout>
  );
};

export default DashboardMain;
