import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ThemeToggle from './ThemeToggle';

const setTheme = vi.fn();

vi.mock('@components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}));

const renderToggle = (full = false) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ThemeToggle full={full} />
    </IntlProvider>
  );

describe('ThemeToggle', () => {
  it('names each compact option even though it shows only an icon', () => {
    renderToggle();

    expect(screen.getByRole('radio', { name: 'Match system' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.queryByText('Light')).not.toBeInTheDocument();
  });

  it('labels each option visibly in full mode', () => {
    renderToggle(true);

    expect(screen.getByText('Match system')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveTextContent('Dark');
  });

  it('switches to the chosen theme', () => {
    renderToggle();

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
