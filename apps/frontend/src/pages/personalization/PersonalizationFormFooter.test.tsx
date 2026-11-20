import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import PersonalizationFormFooter from './PersonalizationFormFooter';

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

const renderFooter = (props: Partial<React.ComponentProps<typeof PersonalizationFormFooter>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <PersonalizationFormFooter
        saveLabel="Save thing"
        canSave
        isSubmitting={false}
        onSave={vi.fn()}
        secondaryAction="cancel"
        onSecondary={vi.fn()}
        {...props}
      />
    </IntlProvider>
  );

const remove = (onConfirm = vi.fn().mockResolvedValue(undefined)) => ({
  title: 'Remove thing?',
  titleContext: 'Thing',
  body: <p>Sure?</p>,
  confirmLabel: 'Remove thing',
  onConfirm,
});

describe('PersonalizationFormFooter', () => {
  it('saves, and cancels or discards depending on what it is for', () => {
    const onSave = vi.fn();
    const onSecondary = vi.fn();
    const { unmount } = renderFooter({ onSave, onSecondary });

    fireEvent.click(screen.getByRole('button', { name: 'Save thing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalled();
    expect(onSecondary).toHaveBeenCalled();
    unmount();

    renderFooter({ secondaryAction: 'discard' });
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });

  it('disables saving when there is nothing to save, and while submitting', () => {
    const { unmount } = renderFooter({ canSave: false });
    expect(screen.getByRole('button', { name: 'Save thing' })).toBeDisabled();
    unmount();

    renderFooter({ isSubmitting: true });
    expect(screen.getByRole('button', { name: 'Save thing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('hides the secondary action when asked', () => {
    renderFooter({ showSecondary: false });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('offers no way to remove unless there is something saved', () => {
    renderFooter();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('asks before removing, and closes once it is removed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderFooter({ remove: remove(onConfirm) });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove thing?')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove thing' }));
    expect(onConfirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Remove thing?')).not.toBeInTheDocument());
  });

  it('keeps what is saved when removing is backed out of', () => {
    const onConfirm = vi.fn();
    renderFooter({ remove: remove(onConfirm) });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Remove thing?')).not.toBeInTheDocument();
  });
});
