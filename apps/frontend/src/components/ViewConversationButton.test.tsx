import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Conversation } from '@customTypes/conversation';

import ViewConversationButton from './ViewConversationButton';

const navigate = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@hooks/useHubPath', () => ({ useHubPath: () => (path: string) => `/hubs/1${path}` }));
vi.mock('@root/SessionContext', () => ({ useSession: () => ({ user: { id: 7 } }) }));

const buildConversation = (participant: object, participantId: number) => ({
  id: 3,
  participant_id: participantId,
  participant,
}) as unknown as Conversation;

const renderButton = (props: React.ComponentProps<typeof ViewConversationButton>) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ViewConversationButton {...props} />
    </IntlProvider>
  );

describe('ViewConversationButton', () => {
  beforeEach(() => navigate.mockClear());

  it('renders nothing until the conversation has loaded', () => {
    const { container } = renderButton({});
    expect(container).toBeEmptyDOMElement();
  });

  it('opens an end-user conversation at the given message', () => {
    renderButton({ conversation: buildConversation({ type: 'ExternalUser' }, 9), messageId: 20 });

    fireEvent.click(screen.getByRole('button', { name: 'View full conversation' }));

    expect(navigate).toHaveBeenCalledWith('/hubs/1/conversations/audience/3?messageId=20');
  });

  it('opens a team conversation without a message', () => {
    renderButton({ conversation: buildConversation({ type: 'User' }, 9) });

    fireEvent.click(screen.getByRole('button', { name: 'View full conversation' }));

    expect(navigate).toHaveBeenCalledWith('/hubs/1/conversations/team/3');
  });

  it('opens the reader’s own conversation under me', () => {
    renderButton({ conversation: buildConversation({ type: 'User' }, 7) });

    fireEvent.click(screen.getByRole('button', { name: 'View full conversation' }));

    expect(navigate).toHaveBeenCalledWith('/hubs/1/conversations/me/3');
  });
});
