import clsx from 'clsx';
import React, { useEffect, useState } from "react";

import { useIsTabletScreen } from '@hooks/useLayout';

import LayoutRail from '@ui-components/layout/LayoutRail';
import MobilePageNav from '@ui-components/navigation/MobilePageNav';
import TopNav from '@ui-components/navigation/TopNav';

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

  const hasAnyName = leftName || mainName || rightName;

  return (
    <>
      <div className="layout-frame">
        <LayoutRail
          leftDrawerOpen={leftDrawerOpen}
          onLeftDrawerToggle={() => handleLeftDrawerOpenChange(!leftDrawerOpen)}
        />
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
          {children}
          <div
            className="layout-cover"
            onClick={() => handleLeftDrawerOpenChange(false)}
            aria-hidden="true"
          />
        </main>
      </div>
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
};

const LayoutLeft = ({
  children,
  className,
  homePage = false,
}: LeftProps) => (
  <section
    className={clsx(
      'layout-left-column',
      className,
      {
        'layout-left-column-homepage': homePage,
      }
    )}
  >
    <div className="layout-drawer-wrapper">
      <header>
        <TopNav homePage={homePage} />
      </header>
      <div className="layout-drawer">
        {children}
      </div>
    </div>
  </section>
);

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
