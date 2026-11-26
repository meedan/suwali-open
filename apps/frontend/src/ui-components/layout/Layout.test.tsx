import { Tooltip as TooltipPrimitive } from 'radix-ui';
import React from 'react';
import { IntlProvider } from 'react-intl';
import { BrowserRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Layout } from './Layout';

// Mock window.matchMedia
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false, // default to small screen
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Helper to wrap components with necessary providers
const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          {component}
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </BrowserRouter>
  );
};

// Mock the imported components
vi.mock('@ui-components/navigation/MobilePageNav', () => ({
  default: ({ onChange, currentValue, left, main, right }: {
    onChange: (value: string) => void;
    currentValue: string;
    left?: string | React.ReactNode;
    main?: string | React.ReactNode;
    right?: string | React.ReactNode;
  }) => (
    <div data-testid="mobile-nav" role="radiogroup">
      {left && (
        <label data-testid="mobile-nav-left">
          <input
            type="radio"
            checked={currentValue === 'mobile-left'}
            onChange={() => onChange('mobile-left')}
          />
          {left}
        </label>
      )}
      {main && (
        <label data-testid="mobile-nav-main">
          <input
            type="radio"
            checked={currentValue === 'mobile-main'}
            onChange={() => onChange('mobile-main')}
          />
          {main}
        </label>
      )}
      {right && (
        <label data-testid="mobile-nav-right">
          <input
            type="radio"
            checked={currentValue === 'mobile-right'}
            onChange={() => onChange('mobile-right')}
          />
          {right}
        </label>
      )}
    </div>
  )
}));

vi.mock('@ui-components/navigation/TopNav', () => ({
  default: () => <div data-testid="top-nav" />
}));

vi.mock('@components/Me', () => ({
  default: () => <div data-testid="me" />
}));

vi.mock('@components/Hub', () => ({
  default: () => <div data-testid="hub" />
}));

vi.mock('@ui-components/input/Button', () => ({
  default: ({ onClick, iconLeft, 'aria-label': ariaLabel, 'aria-expanded': ariaExpanded }: {
    onClick: () => void;
    iconLeft: React.ReactNode;
    'aria-label'?: string;
    'aria-expanded'?: boolean;
  }) => (
    <button aria-label={ariaLabel} aria-expanded={ariaExpanded} onClick={onClick}>
      {iconLeft}
    </button>
  )
}));

vi.mock('@ui-components/layout/Icon', () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`}>{id}</span>
}));

vi.mock('@hooks/useHubSettingsDialog', () => ({
  useHubSettingsDialog: () => ({
    isOpen: false,
    tab: undefined,
    hasPendingApprovals: false,
    openHubSettings: vi.fn(),
    onOpenChange: vi.fn(),
  })
}));

describe('Layout', () => {
  describe('child inspection and name extraction', () => {
    it('extracts names from all three columns and passes to MobilePageNav', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left name="Sidebar">Left content</Layout.Left>
          <Layout.Main name="Main Content">Main content</Layout.Main>
          <Layout.Right name="Tools">Right content</Layout.Right>
        </Layout>
      );

      expect(screen.getByTestId('mobile-nav-left')).toHaveTextContent('Sidebar');
      expect(screen.getByTestId('mobile-nav-main')).toHaveTextContent('Main Content');
      expect(screen.getByTestId('mobile-nav-right')).toHaveTextContent('Tools');
    });

    it('handles missing Right column', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left name="Sidebar">Left content</Layout.Left>
          <Layout.Main name="Main Content">Main content</Layout.Main>
        </Layout>
      );

      expect(screen.getByTestId('mobile-nav-left')).toHaveTextContent('Sidebar');
      expect(screen.getByTestId('mobile-nav-main')).toHaveTextContent('Main Content');
      expect(screen.queryByTestId('mobile-nav-right')).not.toBeInTheDocument();
    });

    it('handles columns without names', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main name="Main Content">Main content</Layout.Main>
        </Layout>
      );

      expect(screen.queryByTestId('mobile-nav-left')).not.toBeInTheDocument();
      expect(screen.getByTestId('mobile-nav-main')).toHaveTextContent('Main Content');
    });

    it('does not render MobilePageNav when no names are provided', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main content</Layout.Main>
          <Layout.Right>Right content</Layout.Right>
        </Layout>
      );

      expect(screen.queryByTestId('mobile-nav')).not.toBeInTheDocument();
    });
  });

  describe('mobileTab - uncontrolled', () => {
    it('manages its own mobileTab state with default value', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('mobile-main');
    });

    it('updates mobileTab state when MobilePageNav triggers change', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left name="Left">Left content</Layout.Left>
          <Layout.Main name="Main">Main content</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('mobile-main');

      fireEvent.click(screen.getByTestId('mobile-nav-left'));
      expect(main).toHaveClass('mobile-left');
    });
  });

  describe('mobileTab - controlled', () => {
    it('uses parent-provided mobileTab value', () => {
      const { container } = renderWithProviders(
        <Layout mobileTab="mobile-left" onMobileTabChange={() => {}}>
          <Layout.Left>Left</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('mobile-left');
      expect(main).not.toHaveClass('mobile-main');
    });

    it('calls onMobileTabChange when MobilePageNav triggers change', () => {
      const handleChange = vi.fn();

      renderWithProviders(
        <Layout mobileTab="mobile-main" onMobileTabChange={handleChange}>
          <Layout.Left name="Left">Left content</Layout.Left>
          <Layout.Main name="Main">Main content</Layout.Main>
        </Layout>
      );

      fireEvent.click(screen.getByTestId('mobile-nav-left'));
      expect(handleChange).toHaveBeenCalledWith('mobile-left');
    });

    it('does not update internal state when controlled', () => {
      const { container } = renderWithProviders(
        <Layout mobileTab="mobile-main" onMobileTabChange={() => {}}>
          <Layout.Left name="Left">Left content</Layout.Left>
          <Layout.Main name="Main">Main content</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');

      fireEvent.click(screen.getByTestId('mobile-nav-left'));
      // Should still be mobile-main since parent didn't update
      expect(main).toHaveClass('mobile-main');
    });
  });

  describe('leftDrawerOpen - uncontrolled', () => {
    it('manages its own drawer state starting as closed on small screens', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('layout-responsive-drawer-closed');
      expect(main).not.toHaveClass('layout-responsive-drawer-open');
    });

    it('starts as open on tablet+ screens', () => {
      // Mock tablet+ screen
      window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query === '(min-width: 850px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('layout-responsive-drawer-open');
      expect(main).not.toHaveClass('layout-responsive-drawer-closed');
    });

    it('toggles drawer state when button is clicked', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      const toggleButton = screen.getByRole('button', { name: 'Show/Hide menu' });

      // Initially closed
      expect(main).toHaveClass('layout-responsive-drawer-closed');

      // Click to open
      fireEvent.click(toggleButton);
      expect(main).toHaveClass('layout-responsive-drawer-open');

      // Click to close
      fireEvent.click(toggleButton);
      expect(main).toHaveClass('layout-responsive-drawer-closed');
    });

    it('closes drawer when clicking on layout-cover', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      const cover = container.querySelector('.layout-cover');
      const toggleButton = screen.getByRole('button', { name: 'Show/Hide menu' });

      // First open the drawer
      fireEvent.click(toggleButton);
      expect(main).toHaveClass('layout-responsive-drawer-open');

      // Then close it with the cover
      fireEvent.click(cover!);
      expect(main).toHaveClass('layout-responsive-drawer-closed');
    });
  });

  describe('leftDrawerOpen - controlled', () => {
    it('uses parent-provided leftDrawerOpen value', () => {
      const { container } = renderWithProviders(
        <Layout leftDrawerOpen={true} onLeftDrawerOpenChange={() => {}}>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('layout-responsive-drawer-open');
      expect(main).not.toHaveClass('layout-responsive-drawer-closed');
    });

    it('calls onLeftDrawerOpenChange with correct boolean when button is clicked', () => {
      const handleChange = vi.fn();

      renderWithProviders(
        <Layout leftDrawerOpen={false} onLeftDrawerOpenChange={handleChange}>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show/Hide menu' }));
      expect(handleChange).toHaveBeenCalledWith(true);
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it('does not update internal state when controlled', () => {
      const { container } = renderWithProviders(
        <Layout leftDrawerOpen={false} onLeftDrawerOpenChange={() => {}}>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');

      fireEvent.click(screen.getByRole('button', { name: 'Show/Hide menu' }));
      // Should still be closed since parent didn't update
      expect(main).toHaveClass('layout-responsive-drawer-closed');
    });
  });

  describe('rail', () => {
    it('renders the rail outside the main landmark', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const toggleButton = screen.getByRole('button', { name: 'Show/Hide menu' });
      expect(screen.getByRole('main')).not.toContainElement(toggleButton);
    });

    it('reflects the drawer state on the menu toggle', () => {
      renderWithProviders(
        <Layout>
          <Layout.Left>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const toggleButton = screen.getByRole('button', { name: 'Show/Hide menu' });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('three column layout detection', () => {
    it('applies layout-three-column class when Right column is present', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left</Layout.Left>
          <Layout.Main>Main</Layout.Main>
          <Layout.Right>Right</Layout.Right>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('layout-three-column');
    });

    it('applies layout-three-column class even when Right column has no name', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left name="Left">Left</Layout.Left>
          <Layout.Main name="Main">Main</Layout.Main>
          <Layout.Right>Right</Layout.Right>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).toHaveClass('layout-three-column');
    });

    it('does not apply layout-three-column class when only two columns', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left>Left</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const main = container.querySelector('main');
      expect(main).not.toHaveClass('layout-three-column');
    });
  });

  describe('Layout.Left homePage prop', () => {
    it('applies layout-left-column-homepage class when homePage is true', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left homePage={true}>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const leftSection = container.querySelector('.layout-left-column');
      expect(leftSection).toHaveClass('layout-left-column-homepage');
    });

    it('does not apply layout-left-column-homepage class when homePage is false', () => {
      const { container } = renderWithProviders(
        <Layout>
          <Layout.Left homePage={false}>Left content</Layout.Left>
          <Layout.Main>Main</Layout.Main>
        </Layout>
      );

      const leftSection = container.querySelector('.layout-left-column');
      expect(leftSection).not.toHaveClass('layout-left-column-homepage');
    });
  });

  describe('Layout.Main ref forwarding', () => {
    it('forwards ref to the section element', () => {
      const ref = React.createRef<HTMLElement>();

      renderWithProviders(
        <Layout>
          <Layout.Left>Left</Layout.Left>
          <Layout.Main ref={ref}>Main content</Layout.Main>
        </Layout>
      );

      expect(ref.current).toBeInstanceOf(HTMLElement);
      expect(ref.current?.tagName).toBe('SECTION');
    });
  });
});
