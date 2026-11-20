import clsx from 'clsx';
import React, { useEffect, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { useHubSettingsDialog } from '@hooks/useHubSettingsDialog';
import { useIsTabletScreen } from '@hooks/useLayout';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip.tsx';
import MobilePageNav from '@ui-components/navigation/MobilePageNav';
import TopNav from '@ui-components/navigation/TopNav';

import Hub from '@components/Hub';
import HubSettings from '@components/HubSettings';
import Me from '@components/Me';

const messages = defineMessages({
  showHideMenu: {
    id: 'global.showHideMenu',
    defaultMessage: 'Show/Hide menu',
    description: 'Label for button to show or hide a menu',
  },
  hubSettings: {
    id: 'global.hubSettings',
    defaultMessage: 'System settings',
    description: 'Title for main navigation to go to the settings page for this system',
  },
});

type LayoutProps = {
  children?: React.ReactNode;
  className?: string;
  mobileTab?: string;
  onMobileTabChange?: (value: string) => void;
  leftDrawerOpen?: boolean;
  onLeftDrawerOpenChange?: (open: boolean) => void;
};

export const Layout = ({
  children,
  className,
  mobileTab: controlledMobileTab,
  onMobileTabChange,
  leftDrawerOpen: controlledLeftDrawerOpen,
  onLeftDrawerOpenChange,
}: LayoutProps) => {
  const [internalMobileTab, setInternalMobileTab] = useState('mobile-main');
  const isTabletScreen = useIsTabletScreen('850px');
  const [internalLeftDrawerOpen, setInternalLeftDrawerOpen] = useState(isTabletScreen);

  // Update internal drawer state when screen size changes (only if uncontrolled)
  useEffect(() => {
    if (controlledLeftDrawerOpen === undefined) {
      setInternalLeftDrawerOpen(isTabletScreen);
    }
  }, [isTabletScreen, controlledLeftDrawerOpen]);

  const mobileTab = controlledMobileTab ?? internalMobileTab;
  const leftDrawerOpen = controlledLeftDrawerOpen ?? internalLeftDrawerOpen;

  const handleMobileTab = (newValue: string) => {
    if (newValue) {
      if (onMobileTabChange) {
        onMobileTabChange(newValue);
      } else {
        setInternalMobileTab(newValue);
      }
    }
  };

  const handleLeftDrawerOpenChange = (open: boolean) => {
    if (onLeftDrawerOpenChange) {
      onLeftDrawerOpenChange(open);
    } else {
      setInternalLeftDrawerOpen(open);
    }
  };

  const getLayoutInfo = (childArray: ReturnType<typeof React.Children.toArray>) => {
    let hasRightColumn = false;
    let leftName: string | React.ReactNode | undefined;
    let mainName: string | React.ReactNode | undefined;
    let rightName: string | React.ReactNode | undefined;

    childArray.forEach(child => {
      if (React.isValidElement(child)) {
        if (child.type === Layout.Left) {
          leftName = (child.props as LeftProps)?.name;
        } else if (child.type === Layout.Main) {
          mainName = (child.props as MainProps)?.name;
        } else if (child.type === Layout.Right) {
          hasRightColumn = true;
          rightName = (child.props as RightProps)?.name;
        }
      }
    });

    return { hasRightColumn, leftName, mainName, rightName };
  };

  const childArray = React.Children.toArray(children);
  const { hasRightColumn, leftName, mainName, rightName } = getLayoutInfo(childArray);

  // Clone the LayoutLeft child with controlled props
  const controlledChildren = React.Children.map(children, child => {
    if (React.isValidElement(child) && child.type === Layout.Left) {
      return React.cloneElement(child as React.ReactElement<LeftProps>, {
        isOpen: leftDrawerOpen,
        onOpenChange: handleLeftDrawerOpenChange,
      });
    }
    return child;
  });

  const hasAnyName = leftName || mainName || rightName;

  return (
    <>
      <main
        className={clsx(
          className,
          mobileTab,
          {
            'layout-three-column': hasRightColumn,
            'layout-responsive-drawer-open': leftDrawerOpen,
            'layout-responsive-drawer-closed': !leftDrawerOpen,
          })
        }
      >
        {controlledChildren}
        <div
          className="layout-cover"
          onClick={() => handleLeftDrawerOpenChange(false)}
          aria-hidden="true"
        />
      </main>
      {hasAnyName && (
        <MobilePageNav
          onChange={handleMobileTab}
          currentValue={mobileTab}
          left={leftName}
          main={mainName}
          right={rightName}
        />
      )}
    </>
  );
}

type LeftProps = {
  children?: React.ReactNode;
  className?: string;
  homePage?: boolean;
  /** Used by parent Layout component, not by LayoutLeft itself */
  name?: string | React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const LayoutLeft = ({
  children,
  className,
  homePage = false,
  isOpen,
  onOpenChange,
}: LeftProps) => {
  const intl = useIntl();
  const { openHubSettings } = useHubSettingsDialog();

  const handleLeftNavClick = () => {
    if (onOpenChange) {
      onOpenChange(!(isOpen ?? false));
    }
  };

  return (
    <section
      className={clsx(
        'layout-left-column',
        className,
        {
          'layout-left-column-homepage': homePage,
        }
      )}
    >
      <div className="layout-shelf">
        <header>
          <Hub avatar />
          <Tooltip content={intl.formatMessage(messages.showHideMenu)}>
            <Button
              aria-label={intl.formatMessage(messages.showHideMenu)}
              themeMode
              variant="filled"
              size="small"
              iconLeft={isOpen ? <Icon id="sidebar" aria-hidden /> : <Icon id="sidebar_closed" aria-hidden />}
              onClick={handleLeftNavClick}
            />
          </Tooltip>
        </header>
        <footer>
          <Tooltip content={<FormattedMessage {...messages.hubSettings} />}>
            <Button
              aria-label={intl.formatMessage(messages.hubSettings)}
              themeMode
              variant="filled"
              size="small"
              iconLeft={<Icon id="settings" aria-hidden />}
              onClick={openHubSettings}
            />
          </Tooltip>
          <Me />
        </footer>
      </div>
      <div className="layout-drawer-wrapper">
        <header>
          <TopNav homePage={homePage} />
        </header>
        <div className="layout-drawer">
          {children}
        </div>
      </div>
      <HubSettings />
    </section>
  );
}

Layout.Left = LayoutLeft;

type MainProps = {
  children?: React.ReactNode;
  className?: string;
  /** Used by parent Layout component, not by LayoutMain itself */
  name?: string | React.ReactNode;
};

const LayoutMain = React.forwardRef<HTMLElement, MainProps>(({
  children,
  className,
}, ref) => (
  <section ref={ref} className={clsx('layout-main-column', className)}>
    {children}
  </section>
));

Layout.Main = LayoutMain;

type RightProps = {
  children?: React.ReactNode;
  className?: string;
  /** Used by parent Layout component, not by LayoutRight itself */
  name?: string | React.ReactNode;
};

const LayoutRight = ({
  children,
  className,
}: RightProps) => (
  <aside className={clsx('layout-right-column', className)}>
    {children}
  </aside>
);

Layout.Right = LayoutRight;
