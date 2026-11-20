import { NavigationMenu } from "radix-ui";
import React from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query';

import { matchesHubPath, startsWithHubPath } from '@helpers/hubPath';

import { createConversation } from '@services/ConversationsService';
import { createNotebook } from '@services/NotebooksService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';
import { useLastConversationsPath } from '@hooks/useLastConversationsPath';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@ui-components/input/DropdownMenu.tsx';
import Icon from '@ui-components/layout/Icon';

import Hub from '@components/Hub';

import MainPagesNav from './MainPagesNav';
import styles from './TopNav.module.css';

const messages = defineMessages({
  untitledNotebook: {
    id: 'notebooksSidebar.untitledNotebook',
    defaultMessage: 'Untitled notebook',
    description: 'Default notebook title',
  },
  createNotebookError: {
    id: 'notebooksSidebar.createNotebookError',
    defaultMessage: 'There was an error creating the notebook. Please try again.',
    description: 'Error message when creating a new notebook fails',
  },
  untitledConversation: {
    id: 'global.untitledConversation',
    defaultMessage: 'Untitled conversation',
    description: 'Default conversation title',
  },
  createConversationError: {
    id: 'global.createConversationError',
    defaultMessage: 'There was an error creating the conversation. Please try again.',
    description: 'Error message when creating a conversation fails',
  },
});

type TopNavProps = {
  homePage: boolean;
};

type NavItemProps = {
  to: string;
  icon?: string;
  matchPath: string;
  children: React.ReactNode;
};

const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(
  ({ to, icon, matchPath, children, ...props }, forwardedRef) => {
    const { pathname } = useLocation();
    const isActive = matchesHubPath(pathname, matchPath) || startsWithHubPath(pathname, `${matchPath}/`);

    return (
      <NavigationMenu.Link asChild>
        <NavLink to={to} className={isActive ? 'active' : undefined} {...props} ref={forwardedRef}>
          {icon && <Icon id={icon} className={styles.sectionIcon} aria-hidden />}
          <span>{children}</span>
        </NavLink>
      </NavigationMenu.Link>
    );
  }
);

const TopNav: React.FC<TopNavProps> = ({homePage}) => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();
  const lastConversationsPath = useLastConversationsPath();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canCreateNotebook = useCan('CREATE_NOTEBOOK').allowed;
  const canCreateConversation = useCan('CREATE_CONVERSATION').allowed;
  const canCreateSource = useCan('CREATE_SOURCE').allowed;
  const canCreateAnything = canCreateNotebook || canCreateConversation || canCreateSource;

  const handleCreateNotebook = async () => {
    if (!hubId) return;

    try {
      const newNotebook = await createNotebook({
        notebook: { hub_id: hubId, name: intl.formatMessage(messages.untitledNotebook) },
      });
      await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks`] });
      navigate(hubPath(`/notebooks/${newNotebook.id}`));
    } catch {
      toast('error', intl.formatMessage(messages.createNotebookError));
    }
  };

  const handleCreateConversation = async () => {
    if (!hubId) return;

    try {
      const newConversation = await createConversation(hubId, intl.formatMessage(messages.untitledConversation));
      await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/conversations`] });
      navigate(hubPath(`/conversations/me/${newConversation.id}`));
    } catch {
      toast('error', intl.formatMessage(messages.createConversationError));
    }
  };

  return (
    <>
      {
        homePage ? <Hub name />
        :
        <NavigationMenu.Root className={styles.topNavMenuWrapper}  delayDuration={1_000_000} skipDelayDuration={0}>
          <NavigationMenu.List className={styles.menuList}>
            <NavigationMenu.Item>
              <NavigationMenu.Trigger className={styles.trigger}>
                <NavItem to={hubPath('/dashboard')} matchPath="/dashboard">
                  <FormattedMessage
                    id="global.dashboard"
                    defaultMessage="Dashboard"
                    description="Reusable label for Dashboard page or link title"
                  />
                </NavItem>
                <NavItem to={lastConversationsPath} matchPath="/conversations">
                  <FormattedMessage
                    id="global.conversations"
                    defaultMessage="Conversations"
                    description="Reusable label for Conversations page or list title"
                  />
                </NavItem>
                <NavItem to={hubPath('/notebooks')} matchPath="/notebooks">
                  <FormattedMessage
                    id="global.notebooks"
                    defaultMessage="Notebooks"
                    description="Reusable label for Notebooks page or list title"
                  />
                </NavItem>
                <NavItem to={hubPath('/data-sources')} matchPath="/data-sources">
                  <FormattedMessage
                    id="global.dataSources"
                    defaultMessage="Data sources"
                    description="Reusable label for Data Sources page or list title"
                  />
                </NavItem>
                <NavItem to={hubPath('/personalization')} matchPath="/personalization">
                  <FormattedMessage
                    id="global.personalizations"
                    defaultMessage="Personalizations"
                    description="Title for personalization/bot identity settings"
                  />
                </NavItem>
                <Icon id="chevron_down" className={styles.triggerIndicator} aria-hidden />
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className={styles.topNavMenu}>
                <MainPagesNav />
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          </NavigationMenu.List>
          <div className={styles.viewportPosition}>
            <NavigationMenu.Viewport className={styles.topNavMenuViewport} />
          </div>
        </NavigationMenu.Root>
      }
      {canCreateAnything &&
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              iconLeft={<Icon id="plus" aria-hidden />}
              size="medium"
              themeMode
              label={
                <FormattedMessage
                  id="global.new"
                  defaultMessage="New"
                  description="Generic title or label for new items"
                />
              }
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canCreateConversation &&
              <DropdownMenuItem>
                <Button
                  iconLeft={<Icon id="conversations" aria-hidden />}
                  size="medium"
                  themeMode
                  variant="menu"
                  label={
                    <FormattedMessage
                      id="global.conversation"
                      defaultMessage="Conversation"
                      description="Reusable label for Conversation page or title"
                    />
                  }
                  onClick={handleCreateConversation}
                />
              </DropdownMenuItem>
            }
            {canCreateNotebook &&
              <DropdownMenuItem>
                <Button
                  iconLeft={<Icon id="notebook" aria-hidden />}
                  size="medium"
                  themeMode
                  variant="menu"
                  label={
                    <FormattedMessage
                      id="global.notebook"
                      defaultMessage="Notebook"
                      description="Reusable label for a notebook page or title"
                    />
                  }
                  onClick={handleCreateNotebook}
                />
              </DropdownMenuItem>
            }
            {canCreateSource &&
              <DropdownMenuItem>
                <Button
                  iconLeft={<Icon id="graph" aria-hidden />}
                  size="medium"
                  themeMode
                  variant="menu"
                  label={
                    <FormattedMessage
                      id="global.dataSourceTitle"
                      defaultMessage="Data source"
                      description="Title for data source entity"
                    />
                  }
                  onClick={() => {
                    navigate(hubPath('/data-sources/new'));
                  }}
                />
              </DropdownMenuItem>
            }
          </DropdownMenuContent>
        </DropdownMenu>
      }
    </>
  );
};

export default TopNav;
