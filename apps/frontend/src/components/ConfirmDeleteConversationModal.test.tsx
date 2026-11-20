import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { Conversation } from '@customTypes/conversation';

import { buildConversation } from '@root/test/fixtures/conversation';

import ConfirmDeleteConversationModal from './ConfirmDeleteConversationModal';

const renderModal = (platform: Conversation['platform']) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ConfirmDeleteConversationModal
        conversation={buildConversation({ platform })}
        open
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    </IntlProvider>
  );

const iconHref = (id: string) => `use[href="/assets/icons/${id}.svg?#icon"]`;

describe('ConfirmDeleteConversationModal', () => {
  it('shows the bot icon for an internal conversation', () => {
    renderModal('internal');

    expect(document.body.querySelector(iconHref('bot'))).toBeInTheDocument();
  });

  it('shows the platform icon for an external conversation', () => {
    renderModal('whatsapp');

    expect(document.body.querySelector(iconHref('whatsapp'))).toBeInTheDocument();
    expect(document.body.querySelector(iconHref('bot'))).not.toBeInTheDocument();
  });

  it('shows the display name of an external user instead of the stored title', () => {
    render(
      <IntlProvider locale="en" messages={{}}>
        <ConfirmDeleteConversationModal
          conversation={buildConversation({
            platform: 'whatsapp',
            title: 'Real Name',
            participant: { ...buildConversation().participant, type: 'ExternalUser', name: 'user-14' } as Conversation['participant'],
          })}
          open
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </IntlProvider>
    );

    expect(document.body).toHaveTextContent('user-14');
    expect(document.body).not.toHaveTextContent('Real Name');
  });

  it('warns that deleting removes the conversation from statistics', () => {
    renderModal('whatsapp');

    expect(document.body).toHaveTextContent(/removed from your dashboard statistics/);
    expect(document.body).toHaveTextContent(/cannot be undone/);
  });
});
