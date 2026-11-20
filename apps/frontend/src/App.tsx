import { lazy, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { SimpleAnalytics } from "@simpleanalytics/react";

import type { User } from '@customTypes/user';

import { matchesHubPath, startsWithHubPath } from '@helpers/hubPath';

import { useCapabilities } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';
import { useUserOnboardingTasks } from '@hooks/useUserOnboardingTasks';

import { PanelLoading } from '@ui-components/layout/LoadingIndicator';

import NotFound from '@layouts/error/NotFound.tsx';
import InterstitialLayout from '@layouts/InterstitialLayout.tsx'
import LoginLayout from '@layouts/LoginLayout.tsx'
import MainLayout from '@layouts/MainLayout.tsx'

import LazyRoute from '@components/LazyRoute.tsx';
import OnboardingModal from '@components/OnboardingModal.tsx';
import ProtectedRoute from '@components/ProtectedRoute.tsx'

import ChangePassword from '@pages/ChangePassword.tsx'
import ConversationsMain from '@pages/conversations/ConversationsMain.tsx'
import DashboardMain from '@pages/dashboard/DashboardMain.tsx'
import DataSourcesMain from '@pages/data-sources/DataSourcesMain.tsx'
import EmailConfirmation from '@pages/EmailConfirmation';
import ForgotPassword from '@pages/ForgotPassword.tsx'
import HubSetupPage from '@pages/hub-setup/HubSetup.tsx'
import JoinHub from '@pages/JoinHub.tsx';
import Login from '@pages/Login.tsx'
import NotebooksMain from '@pages/notebooks/NotebooksMain.tsx'
import PersonalizationMain from '@pages/personalization/PersonalizationMain.tsx'
import Plans from '@pages/Plans.tsx'
import Signup from '@pages/Signup.tsx'
import UpdatesMain from '@pages/updates/UpdatesMain.tsx'

import Config from './Config';
import { NetworkError, whenApiReachable } from './NetworkLayer';
import { useSession } from './SessionContext.tsx'

const PlatformAdminDashboard = lazy(() => import('@pages/platform-admin/Dashboard.tsx'));
const PlatformAdminMessageReportsExport = lazy(() => import('@pages/platform-admin/MessageReportsExport.tsx'));
const PlatformAdminExportHubConversations = lazy(() => import('@pages/platform-admin/ExportHubConversations.tsx'));
const PlatformAdminHubDetails = lazy(() => import('@pages/platform-admin/HubDetails.tsx'));
const PlatformAdminDeletedHubDetails = lazy(() => import('@pages/platform-admin/DeletedHubDetails.tsx'));

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const hubPath = useHubPath();
  const { can } = useCapabilities();

  const [checkingSession, setCheckingSession] = useState(true);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const { ownSourceCreated, ownDocumentSynced, internalConversationMessageReceived, isPending: isHubTasksPending } = useHubSetupTasks();
  const { internalConversationStarted, isPending: isUserTasksPending } = useUserOnboardingTasks();

  const onboardUser = useCallback((user: User) => {
    // The URL names no usable hub, so its not-available page is shown instead of any onboarding
    if (session.hubUnavailable()) return;

    const hasNoHub = !user.hubs || user.hubs.filter((h) => h.hub_membership && h.hub_membership.approved).length === 0;

    // The /hub/setup path also bypasses the redirect while a hub-less user is creating their organization there,
    // but once a hub exists, it must fall through to the hubSetupComplete redirect check below.
    const onboardingPaths = hasNoHub ? ['/hub/join', '/hub/setup'] : ['/hub/join'];

    if (onboardingPaths.some(p => matchesHubPath(location.pathname, p))) {
      return;
    }

    if (session.isSuperAdminGuest()) {
      setOnboardingOpen(false);
      return;
    }

    if (user.confirmed) {
      if (hasNoHub && user.is_admin) {
        if (!location.pathname.startsWith('/platform-admin')) navigate('/platform-admin');
        setOnboardingOpen(false);
      } else if (hasNoHub) {
        navigate('/hub/join');
        setOnboardingOpen(false);
      } else {
        if (isHubTasksPending || isUserTasksPending) return;
        const isAdmin = can('UPDATE_HUB').allowed;
        // Preloaded content does not count - setup keeps asking for the hub's own content
        const hubSetupComplete = ownSourceCreated && ownDocumentSynced && internalConversationMessageReceived;

        if (matchesHubPath(location.pathname, '/hub/setup')) {
          setOnboardingOpen(false);
          if (hubSetupComplete || !isAdmin) navigate(hubPath('/dashboard'));
          return;
        }

        if (isAdmin) {
          const currentHubId = user.hubs?.find((h) => h.hub_membership?.approved)?.id;
          const setupSkipped = currentHubId ? localStorage.getItem(`hub_setup_skipped_${currentHubId}`) === 'true' : false;
          const isOnConversation = startsWithHubPath(location.pathname, '/conversations/');
          if (!hubSetupComplete && !setupSkipped && !isOnConversation) {
            navigate(hubPath('/hub/setup'));
            return;
          }
          if (isOnConversation) {
            setOnboardingOpen(false);
            return;
          }
        }

        const shouldShowModal = isAdmin
          ? (!internalConversationStarted && hubSetupComplete)
          : (!user.name || !internalConversationStarted || !hubSetupComplete);
        setOnboardingOpen(shouldShowModal);
      }
    }
  }, [location.pathname, navigate, session, can, ownSourceCreated, ownDocumentSynced, internalConversationMessageReceived, internalConversationStarted, isHubTasksPending, isUserTasksPending, hubPath]);

  useLayoutEffect(() => {
    if (session.user) {
      onboardUser(session.user);
    }
  }, [session.user, onboardUser]);

  useEffect(() => {
    const publicPaths = ['/', '/login', '/signup', '/confirm', '/forgot-password', '/change-password'];

    // Being offline is not being signed out: keep loading and try again once the API answers
    const restoreWhenReachable = (): Promise<User | null> => session.restore()
      .catch(error => {
        if (!(error instanceof NetworkError)) throw error;
        return whenApiReachable().then(restoreWhenReachable);
      });

    restoreWhenReachable()
      .then(user => {
        if (user) {
          if (publicPaths.includes(location.pathname)) {
            navigate(hubPath('/dashboard'));
          }

          // This call sees the pre-restore session, which would send a super-admin away from their last hub; the layout effect covers them
          if (!user.is_admin) onboardUser(user);
        } else if (!publicPaths.includes(location.pathname)) {
          navigate('/');
        }
      })
      .catch(error => {
        console.error('Error restoring session:', error); // e.g., `401 Unauthorized` error
        if (location.pathname !== '/' && !publicPaths.includes(location.pathname)) {
          navigate('/');
        }
      })
      .finally(() => setCheckingSession(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally run only once on mount to restore session and redirect appropriately

  const hasApprovedHub = Boolean(session.user?.hubs?.some(h => h.hub_membership?.approved));

  const waitingForHub = session.isLoggedIn() && session.currentHub() === undefined;
  const needsRouteResolution = hasApprovedHub && (isHubTasksPending || isUserTasksPending) && !matchesHubPath(location.pathname, '/hub/setup');
  if (session.hubUnavailable()) {
    return (
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    );
  }

  if (checkingSession || waitingForHub || needsRouteResolution) {
    return <PanelLoading appLevel />;
  }

  const hubScopedRoutes = (
    <>
      <Route element={<InterstitialLayout wide />}>
        <Route path="hub/setup" element={<HubSetupPage />} />
      </Route>
      <Route element={<MainLayout />}>
        <Route path="dashboard" element={<DashboardMain />} />
        <Route path="updates" element={<UpdatesMain />} />
        <Route path="not-found" element={<NotFound />} />
        <Route path="plans" element={<Plans />} />
        <Route path="conversations" element={<ConversationsMain />} />
        <Route path="conversations/:from" element={<ConversationsMain />} />
        <Route path="conversations/:from/:conversationId" element={<ConversationsMain />} />
        <Route path="data-sources" element={<DataSourcesMain />} />
        <Route path="data-sources/:sourceId" element={<DataSourcesMain />} />
        <Route path="data-sources/:sourceId/documents/:itemId" element={<DataSourcesMain />} />
        <Route path="data-sources/:sourceId/settings" element={<DataSourcesMain activeAssetType="settings" />} />
        <Route path="data-sources/contributions" element={<DataSourcesMain activeAssetType="contribution" />} />
        <Route path="data-sources/contributions/:itemId" element={<DataSourcesMain activeAssetType="contribution" />} />
        <Route path="data-sources/contributions/settings" element={<DataSourcesMain activeAssetType="contributions_settings" />} />
        <Route path="data-sources/summaries" element={<DataSourcesMain activeAssetType="summary" />} />
        <Route path="data-sources/summaries/:itemId" element={<DataSourcesMain activeAssetType="summary" />} />
        <Route path="data-sources/new" element={<DataSourcesMain activeAssetType="new" />} />
        <Route path="personalization" element={<PersonalizationMain />} />
        <Route path="personalization/:section" element={<PersonalizationMain />} />
        <Route path="personalization/resources/:resourceId" element={<PersonalizationMain />} />
        <Route path="notebooks" element={<NotebooksMain />} />
        <Route path="notebooks/:notebookId" element={<NotebooksMain />} />
        <Route path="notebooks/:notebookId/items/:itemId" element={<NotebooksMain />} />
      </Route>
    </>
  );

return (
  <>
    <Routes>
      <Route element={<LoginLayout />}>
        <Route path="/" index element={<Login />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="change-password" element={<ChangePassword />} />
      </Route>
      <Route element={<InterstitialLayout />}>
        <Route path="confirm" element={<EmailConfirmation />} />
      </Route>

      <Route element={<ProtectedRoute redirectPath='/' isAllowed={session.isLoggedIn()} />}>
        <Route element={<InterstitialLayout />}>
          <Route path="hub/join" element={<JoinHub />} />
        </Route>
        {hubScopedRoutes}
        <Route path="hub/:hubId">
          <Route index element={<Navigate to="dashboard" replace />} />
          {hubScopedRoutes}
        </Route>
        <Route element={<MainLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route element={<ProtectedRoute redirectPath='/not-found' isAllowed={can('IS_ADMIN').allowed} />}>
          <Route
            path="platform-admin"
            element={<LazyRoute><PlatformAdminDashboard /></LazyRoute>}
          />
          <Route
            path="platform-admin/message-reports"
            element={<LazyRoute><PlatformAdminMessageReportsExport /></LazyRoute>}
          />
          <Route
            path="platform-admin/export-hub-conversations"
            element={<LazyRoute><PlatformAdminExportHubConversations /></LazyRoute>}
          />
          <Route
            path="platform-admin/hubs/:hubId"
            element={<LazyRoute><PlatformAdminHubDetails /></LazyRoute>}
          />
          <Route
            path="platform-admin/hubs/:hubId/deleted"
            element={<LazyRoute><PlatformAdminDeletedHubDetails /></LazyRoute>}
          />
        </Route>
      </Route>
    </Routes>

    {session.isLoggedIn() && (
      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onboardUser(session.user!);
            return;
          }
          setOnboardingOpen(nextOpen);
        }}
      />
    )}

    {Config.get('VITE_ENABLE_ANALYTICS', '') === 'true' && <SimpleAnalytics />}
  </>
  );
};
