import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { useDashboardLayoutTier } from './useLayout';

const ONE_COLUMN_QUERY = '(max-width: 1000px)';
const TWO_COLUMN_QUERY = '(min-width: 1000px) and (max-width: 1400px)';

const mockMatchMedia = (matchingQueries: string[]) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matchingQueries.includes(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const TestComponent = () => <span>{useDashboardLayoutTier()}</span>;

describe('useDashboardLayoutTier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns oneColumn when only the max-width query matches', () => {
    mockMatchMedia([ONE_COLUMN_QUERY]);

    render(<TestComponent />);

    expect(screen.getByText('oneColumn')).toBeInTheDocument();
  });

  it('returns oneColumn at the shared boundary, where both queries match', () => {
    mockMatchMedia([ONE_COLUMN_QUERY, TWO_COLUMN_QUERY]);

    render(<TestComponent />);

    expect(screen.getByText('oneColumn')).toBeInTheDocument();
  });

  it('returns twoColumn when only the two-column range query matches', () => {
    mockMatchMedia([TWO_COLUMN_QUERY]);

    render(<TestComponent />);

    expect(screen.getByText('twoColumn')).toBeInTheDocument();
  });

  it('returns threeColumn when neither query matches', () => {
    mockMatchMedia([]);

    render(<TestComponent />);

    expect(screen.getByText('threeColumn')).toBeInTheDocument();
  });
});
