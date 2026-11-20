import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as ConversationsService from '@services/ConversationsService';

import { ToastProvider } from '@hooks/useToast';

import ReportMessageModal from './ReportMessageModal';

vi.mock('@services/ConversationsService', () => ({
  mutateCreateMessageReport: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, titleContext, body, actions, open }: { title: React.ReactNode; titleContext?: React.ReactNode; body: React.ReactNode; actions: React.ReactNode; open?: boolean }) => (
    open ? (
      <dialog open>
        <div>{title}</div>
        <div>{titleContext}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    ) : null
  ),
}));

const renderModal = () => {
  const onOpenChange = vi.fn();

  render(
    <IntlProvider locale="en" messages={{}}>
      <ToastPrimitive.Provider>
        <ToastProvider>
          <ReportMessageModal messageId={42} messageBody="I could not find that in the sources." open onOpenChange={onOpenChange} />
        </ToastProvider>
        <ToastPrimitive.Viewport />
      </ToastPrimitive.Provider>
    </IntlProvider>
  );

  return { onOpenChange };
};

describe('ReportMessageModal', () => {
  beforeEach(() => {
    vi.mocked(ConversationsService.mutateCreateMessageReport).mockReset();
  });

  it('renders the title, an introduction and the context field with its help', () => {
    renderModal();

    expect(screen.getByText('Report a problem with a chatbot response?')).toBeInTheDocument();
    expect(screen.getByText('I could not find that in the sources.')).toBeInTheDocument();
    expect(screen.getByText(/flag this message for review/)).toBeInTheDocument();
    expect(screen.getByText(/tell us which one you expected/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Additional context' })).toBeInTheDocument();
  });

  it('submits the comment for the message, shows a success toast and closes', async () => {
    vi.mocked(ConversationsService.mutateCreateMessageReport).mockResolvedValue({ id: 1, message_id: 42, comment: 'Wrong language', created_at: '' });
    const { onOpenChange } = renderModal();

    fireEvent.change(screen.getByRole('textbox', { name: 'Additional context' }), { target: { value: 'Wrong language' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await screen.findByText('Problem report submitted.');
    expect(ConversationsService.mutateCreateMessageReport).toHaveBeenCalledWith(42, 'Wrong language');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an error toast and stays open with the comment when submitting fails', async () => {
    vi.mocked(ConversationsService.mutateCreateMessageReport).mockRejectedValue(new Error('boom'));
    const { onOpenChange } = renderModal();

    fireEvent.change(screen.getByRole('textbox', { name: 'Additional context' }), { target: { value: 'Wrong language' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await screen.findByText('Failed to submit problem report. Please try again.');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Additional context' })).toHaveValue('Wrong language');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeEnabled());
  });

  it('disables both buttons while the report is being submitted', async () => {
    vi.mocked(ConversationsService.mutateCreateMessageReport).mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('closes without submitting when cancelled', () => {
    const { onOpenChange } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(ConversationsService.mutateCreateMessageReport).not.toHaveBeenCalled();
  });
});
