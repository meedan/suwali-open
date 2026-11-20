import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import Login from './Login';

const renderLogin = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <Login />
      </IntlProvider>
    </MemoryRouter>
  );

describe('Login', () => {
  it('toggles the password field between hidden and visible text when "Show password" is checked', () => {
    renderLogin();

    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('checkbox', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('checkbox', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
