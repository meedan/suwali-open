import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { buildHub } from '@root/test/fixtures/hub';

import { ToastProvider } from '@hooks/useToast';

import ContributionReviewProcessSettings from './ContributionReviewProcessSettings';

const baseHub = buildHub({
  invite_code: 'ABCDEF',
  contribution_code: '#contrib1234',
  active_external_users_count: 3,
  max_documents_for_plan: 10,
});

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHub: () => baseHub }),
}));

vi.mock('@services/HubService', () => ({
  updateContributionWorkflowMode: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions, open }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode; open: boolean }) =>
    open ? (
      <dialog open>
        <div>{title}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    ) : null,
}));

const renderComponent = (onClose = vi.fn()) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ToastProvider>
        <ContributionReviewProcessSettings onClose={onClose} />
      </ToastProvider>
    </IntlProvider>
  );

describe('ContributionReviewProcessSettings', () => {
  it('renders the title and radio cards', () => {
    renderComponent();
    expect(screen.getByText('Contribution review process')).toBeInTheDocument();
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('disables Update process button when mode has not changed', () => {
    renderComponent();
    expect(screen.getByText('Update process').closest('button')).toBeDisabled();
  });

  it('enables Update process button when mode changes', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Review'));
    expect(screen.getByText('Update process').closest('button')).not.toBeDisabled();
  });

  it('closes on Cancel', () => {
    const onClose = vi.fn();
    renderComponent(onClose);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens confirmation modal when Update process is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Review'));
    fireEvent.click(screen.getByText('Update process'));
    expect(screen.getByText('Change review process?')).toBeInTheDocument();
  });
});
