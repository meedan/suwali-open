import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { signup } from '@services/AuthService';

import Signup from './Signup';

vi.mock('@services/AuthService', () => ({
  signup: vi.fn(),
}));

const renderSignup = () =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <Signup />
      </IntlProvider>
    </MemoryRouter>
  );

const fillValidForm = () => {
  fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), {
    target: { value: 'test@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/create your password/i), {
    target: { value: 'Password1!' },
  });
};

describe('Signup', () => {
  it('shows validation errors and does not open modal when form is invalid', () => {
    renderSignup();

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.queryByText(/privacy policy and terms of service/i)).not.toBeInTheDocument();
    expect(vi.mocked(signup)).not.toHaveBeenCalled();
  });

  it('opens the confirmation modal without calling the API when form is valid', () => {
    renderSignup();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getByText(/privacy policy and terms of service/i)).toBeInTheDocument();
    expect(vi.mocked(signup)).not.toHaveBeenCalled();
  });

  it('closes the modal without calling the API when Cancel is clicked', () => {
    renderSignup();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(screen.getByText(/privacy policy and terms of service/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByText(/privacy policy and terms of service/i)).not.toBeInTheDocument();
    expect(vi.mocked(signup)).not.toHaveBeenCalled();
  });

  it('toggles the password field between hidden and visible text when "Show password" is checked', () => {
    renderSignup();

    const passwordInput = screen.getByLabelText(/create your password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('checkbox', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('checkbox', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
