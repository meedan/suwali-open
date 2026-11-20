import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Hub } from '@customTypes/hub';

import ConfirmContributionReviewProcessModal from './ConfirmContributionReviewProcessModal';

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode }) => (
    <dialog open>
      <div>{title}</div>
      <div>{body}</div>
      <div>{actions}</div>
    </dialog>
  ),
}));

const renderModal = (
  mode: Hub['contribution_workflow_mode'],
  audience: Hub['contribution_audience'] = 'trusted_end_users',
) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ConfirmContributionReviewProcessModal
        mode={mode}
        audience={audience}
        open={true}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    </IntlProvider>
  );

describe('ConfirmContributionReviewProcessModal', () => {
  it('renders the title', () => {
    renderModal('direct');
    expect(screen.getByText('Change review process?')).toBeInTheDocument();
  });

  it('renders the mode name in the body for direct', () => {
    renderModal('direct');
    expect(screen.getByRole('dialog')).toHaveTextContent('Direct');
    expect(screen.getByRole('dialog')).toHaveTextContent('immediately');
  });

  it('renders the mode name in the body for review', () => {
    renderModal('review');
    expect(screen.getByRole('dialog')).toHaveTextContent('Review');
    expect(screen.getByRole('dialog')).toHaveTextContent('paused');
  });

  it('renders the current audience in the body', () => {
    renderModal('direct', 'all_end_users');
    expect(screen.getByRole('dialog')).toHaveTextContent('Any end-user');
  });
});
