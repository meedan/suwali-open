import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Conversation } from '@customTypes/conversation';

import MetaList from '@ui-components/layout/MetaList';

import ConversationMetaItems from './ConversationMetaItems';

const buildConversation = (participant: Record<string, unknown> = {}): Conversation => ({
  id: 1,
  hub_id: 1,
  participant: { id: 2, type: 'ExternalUser', name: 'Alice Petty', trusted_user: false, ...participant } as Conversation['participant'],
  participant_id: 2,
  platform: 'telegram',
  title: 'Alice Petty',
  created_at: '2026-10-17T11:02:00Z',
  updated_at: '2026-10-17T11:02:00Z',
});

const renderItems = (conversation?: Conversation) =>
  render(
    <IntlProvider locale="en">
      <MetaList>
        <ConversationMetaItems conversation={conversation} />
      </MetaList>
    </IntlProvider>,
  );

describe('ConversationMetaItems', () => {
  it('says who the conversation is with and whether they are trusted', () => {
    renderItems(buildConversation());

    expect(screen.getByText('Alice Petty')).toBeInTheDocument();
    expect(screen.getByText(/Platform:/)).toBeInTheDocument();
    expect(screen.getByText(/Trusted end-user:/)).toBeInTheDocument();
  });

  it('leaves out the trusted status for someone on the team', () => {
    renderItems(buildConversation({ type: 'User' }));

    expect(screen.queryByText(/Trusted end-user:/)).not.toBeInTheDocument();
  });

  it('renders while the conversation is still loading', () => {
    renderItems(undefined);

    expect(screen.getByText(/Platform:/)).toBeInTheDocument();
    expect(screen.queryByText(/Trusted end-user:/)).not.toBeInTheDocument();
  });
});
