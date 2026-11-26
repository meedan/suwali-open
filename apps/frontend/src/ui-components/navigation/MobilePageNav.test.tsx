import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import MobilePageNav from './MobilePageNav';

vi.mock('@ui-components/navigation/MainPagesNav', () => ({
  default: () => <div data-testid="main-pages-nav" />
}));

vi.mock('@components/Me', () => ({
  default: () => <div data-testid="me" />
}));

describe('MobilePageNav', () => {
  it('opens the main menu as a dialog named for screen readers', () => {
    render(
      <IntlProvider locale="en" messages={{}}>
        <MobilePageNav />
      </IntlProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));

    expect(screen.getByRole('dialog', { name: 'Main menu' })).toContainElement(screen.getByTestId('main-pages-nav'));
  });
});
