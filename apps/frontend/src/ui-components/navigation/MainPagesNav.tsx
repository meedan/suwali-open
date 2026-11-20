import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { NavLink, useLocation } from 'react-router'

import { matchesHubPath, startsWithHubPath } from '@helpers/hubPath';

import { useCan } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';
import { useHubSettingsDialog } from '@hooks/useHubSettingsDialog';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';
import { useLastConversationsPath } from '@hooks/useLastConversationsPath';

import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import EditorOnboardingChecklist from '@components/EditorOnboardingChecklist';

import TrialSidebarBanner from '@trial-banners/TrialSidebarBanner';

import UpdatesNavItem from '@pages/updates/UpdatesNavItem';

import styles from './MainPagesNav.module.css'

const messages = defineMessages({
  dashboard: {
    id: 'global.dashboard',
    defaultMessage: 'Dashboard',
    description: 'Reusable label for Dashboard page or link title',
  },
  conversations: {
    id: 'global.conversations',
    defaultMessage: 'Conversations',
    description: 'Reusable label for Conversations page or list title',
  },
  notebooks: {
    id: 'global.notebooks',
    defaultMessage: 'Notebooks',
    description: 'Reusable label for Notebooks page or list title',
  },
  dataSources: {
    id: 'global.dataSources',
    defaultMessage: 'Data sources',
    description: 'Reusable label for Data Sources page or list title',
  },
  personalization: {
    id: 'global.personalizations',
    defaultMessage: 'Personalizations',
    description: 'Title for personalization/bot identity settings',
  },
});

type MainPagesNavProps = {
  homePage?: boolean;
};

const MainPagesNav = ({
  homePage = false
}: MainPagesNavProps) => {
  const intl = useIntl();
  const hubPath = useHubPath();
  const isAdmin = useCan('UPDATE_HUB').allowed;
  const lastConversationsPath = useLastConversationsPath();
  // Deliberately not the own_ flag: preloaded content is enough to unlock the app so users can try it
  // out. Only the onboarding calls to action keep asking for the hub's own content.
  const { documentSynced } = useHubSetupTasks();
  const setupNavDisabled = !documentSynced;

  const { hasPendingApprovals, openHubSettings } = useHubSettingsDialog();

  const { pathname } = useLocation();
  const hubActiveClass = (matchPath: string, extraClass?: string) =>
    clsx(extraClass, {
      active: matchesHubPath(pathname, matchPath) || startsWithHubPath(pathname, `${matchPath}/`),
    });

  return (
    <nav
      className={clsx(
        [styles.mainPages],
        {
          ['layout-left-column-scrollable-area']: homePage,
          [styles.homePage]: homePage
        })
      }
    >
      <menu>
        <li>
          <NavLink to={hubPath('/dashboard')} title={intl.formatMessage(messages.dashboard)} className={hubActiveClass('/dashboard')}>
            <Icon id="house" className={styles.sectionIcon} aria-labelledby="dashboard" />
            <span id="dashboard">
              <FormattedMessage
                id="global.dashboard"
                defaultMessage="Dashboard"
                description="Reusable label for Dashboard page or link title"
              />
            </span>
            <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
          </NavLink>
        </li>
        <li>
          <NavLink to={lastConversationsPath} title={intl.formatMessage(messages.conversations)} className={hubActiveClass('/conversations')}>
            <Icon id="conversations" className={styles.sectionIcon} aria-labelledby="conversations" />
            <span id="conversations">
                <FormattedMessage
                  id="global.conversations"
                  defaultMessage="Conversations"
                  description="Reusable label for Conversations page or list title"
                />
            </span>
            <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
          </NavLink>
        </li>
        <li>
          {setupNavDisabled
            ? <Tooltip content={
                <FormattedMessage
                  id="mainPagesNav.notebooksDisabledTooltip"
                  defaultMessage="Add a data source and wait for it to sync before using notebooks."
                  description="Tooltip shown when Notebooks nav item is disabled during onboarding"
                />
              }>
                <span>
                  <NavLink
                    to={hubPath('/notebooks')}
                    title={intl.formatMessage(messages.notebooks)}
                    className={hubActiveClass('/notebooks', styles.navItemDisabled)}
                    onClick={(e) => e.preventDefault()}
                    aria-disabled
                  >
                    <Icon id="lock" className={styles.sectionIcon} aria-labelledby="notebooks" />
                    <span id="notebooks">
                      <FormattedMessage
                        id="global.notebooks"
                        defaultMessage="Notebooks"
                        description="Reusable label for Notebooks page or list title"
                      />
                    </span>
                    <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
                  </NavLink>
                </span>
              </Tooltip>
            :
              <NavLink to={hubPath('/notebooks')} title={intl.formatMessage(messages.notebooks)} className={hubActiveClass('/notebooks')}>
                <Icon id="notebook" className={styles.sectionIcon} aria-labelledby="notebooks" />
                <span id="notebooks">
                  <FormattedMessage
                    id="global.notebooks"
                    defaultMessage="Notebooks"
                    description="Reusable label for Notebooks page or list title"
                  />
                </span>
                <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
              </NavLink>
          }
        </li>
        <li className={styles.sectionBreak}>
          <NavLink to={hubPath('/personalization')} title={intl.formatMessage(messages.personalization)} className={hubActiveClass('/personalization')}>
            <Icon id="bot_voice" className={styles.sectionIcon} aria-labelledby="personalization" />
            <span id="personalization">
              <FormattedMessage
                id="global.personalizations"
                defaultMessage="Personalizations"
                description="Title for personalization/bot identity settings"
              />
            </span>
            <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
          </NavLink>
        </li>
        <li>
          <NavLink to={hubPath('/data-sources')} title={intl.formatMessage(messages.dataSources)} className={hubActiveClass('/data-sources')}>
            <Icon id="graph" className={styles.sectionIcon} aria-labelledby="dataSources" />
            <span id="dataSources">
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
              />
            </span>
            <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
          </NavLink>
        </li>
        <li className={styles.mainPagesMenuSettings}>
          <button onClick={openHubSettings}>
            <Icon id="settings" className={styles.sectionIcon} aria-labelledby="settings" />
            <span id="settings">
              <FormattedMessage
                id="mainPagesNav.hubSettings"
                defaultMessage="System settings"
                description="Title for main navigation to go to the settings page for this system"
              />
              {/* Hidden text rather than an aria-label, which goes unread on a span with no role */}
              {hasPendingApprovals ?
                <span className={styles.pendingApprovalsIndicator}>
                  <VisuallyHidden.Root>
                    <FormattedMessage
                      id="global.pendingApprovals"
                      defaultMessage="Pending approvals"
                      description="Reusable label for showing that the system has pending approvals"
                    />
                  </VisuallyHidden.Root>
                </span>
                : null
              }
            </span>
            <Icon id="chevron_right" className={clsx(styles.sectionNavigate, 'icon-flip-rtl')} aria-hidden />
          </button>
        </li>
      </menu>
      {homePage &&
        <div className={styles.homeNavExtras}>
          { !isAdmin && <EditorOnboardingChecklist /> }
          <UpdatesNavItem />
          <TrialSidebarBanner />
        </div>
      }
    </nav>
  );
};

export default MainPagesNav;
