import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import PreviewDetailsDate from './PreviewDetailsDate';

const renderDate = (value: string) => render(
  <IntlProvider locale="en" messages={{}}>
    <span data-testid="date"><PreviewDetailsDate value={value} /></span>
  </IntlProvider>
);

describe('PreviewDetailsDate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves out the year for a date in the current year', () => {
    renderDate(new Date(2026, 10, 20, 13, 45).toISOString());

    expect(screen.getByTestId('date')).not.toHaveTextContent('2026');
  });

  it('shows the year for a date in a previous year', () => {
    renderDate(new Date(2025, 10, 20, 13, 45).toISOString());

    expect(screen.getByTestId('date')).toHaveTextContent('2025');
  });
});
