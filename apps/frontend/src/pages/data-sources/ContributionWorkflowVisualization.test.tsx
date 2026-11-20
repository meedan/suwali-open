import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import ContributionWorkflowVisualization from './ContributionWorkflowVisualization';

const renderComponent = (mode: 'direct' | 'review') =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ContributionWorkflowVisualization
        mode={mode}
        audience="trusted_end_users"
        contributionCode="#contrib1234"
        trustedEndUsersCount={5}
      />
    </IntlProvider>
  );

describe('ContributionWorkflowVisualization', () => {
  it('renders the contribution code in the first step', () => {
    renderComponent('direct');
    expect(screen.getByText('#contrib1234')).toBeInTheDocument();
  });

  it('renders the trusted end-users count', () => {
    renderComponent('direct');
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('renders direct-specific last step', () => {
    renderComponent('direct');
    expect(screen.getByText(/immediately available/)).toBeInTheDocument();
  });

  it('renders review-specific last step', () => {
    renderComponent('review');
    expect(screen.getByText(/paused/)).toBeInTheDocument();
  });
});
