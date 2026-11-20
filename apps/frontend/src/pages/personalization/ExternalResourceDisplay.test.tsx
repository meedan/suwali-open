import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ExternalResource } from '@customTypes/external-resource';

import ExternalResourceDisplay from './ExternalResourceDisplay';

const mockResource: ExternalResource = {
  id: 1,
  title: 'Support email',
  description: 'Reach the support team',
  scenarios: ['error_occurred', 'speak_to_person'],
};

const renderDisplay = (props: Partial<React.ComponentProps<typeof ExternalResourceDisplay>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ExternalResourceDisplay resource={mockResource} {...props} />
    </IntlProvider>
  );

describe('ExternalResourceDisplay', () => {
  it('displays the resource title and description', () => {
    renderDisplay();
    expect(screen.getByText('Support email')).toBeInTheDocument();
    expect(screen.getByText('Reach the support team')).toBeInTheDocument();
  });

  it('renders as a button and shows the edit CTA when onEdit is provided', () => {
    const onEdit = vi.fn();
    renderDisplay({ onEdit });
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText('Edit resource')).toBeInTheDocument();
  });

  it('does not render as a button or show the edit CTA when onEdit is omitted', () => {
    renderDisplay();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit resource')).not.toBeInTheDocument();
  });
});
