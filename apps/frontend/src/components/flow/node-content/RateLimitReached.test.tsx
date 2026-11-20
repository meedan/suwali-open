import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Message } from '@customTypes/message';

import RateLimitReached from './RateLimitReached';

const message = { created_at: '2026-10-27T15:45:12Z', direction: 'outgoing' } as Message;

// Mock the Icon component
vi.mock('@ui-components/layout/Icon', () => ({
  default: ({ id }: { id: string }) => (
    <div data-testid={`icon-${id}`} />
  )
}));

// Mock the ParsedText component
vi.mock('@ui-components/layout/ParsedText', () => ({
  default: ({ text }: { text: string }) => (
    <span data-testid="parsed-text">{text}</span>
  )
}));

describe('RateLimitReached', () => {
  it('renders the rate limit title with countdown icon', () => {
    render(
      <IntlProvider locale="en" messages={{}}>
        <RateLimitReached message={message} body="User message text" />
      </IntlProvider>,
      { wrapper: Tooltip.Provider }
    );

    expect(screen.getByTestId('icon-countdown')).toBeInTheDocument();
    expect(screen.getByText('Rate limit reached')).toBeInTheDocument();
  });

  it('renders the rate limit description', () => {
    render(
      <IntlProvider locale="en" messages={{}}>
        <RateLimitReached message={message} body="User message text" />
      </IntlProvider>,
      { wrapper: Tooltip.Provider }
    );

    expect(screen.getByText(/This message was automatically sent/)).toBeInTheDocument();
    expect(screen.getByText(/because the end-user has reached the conversation rate limit/)).toBeInTheDocument();
  });

  it('renders the user message body using ParsedText', () => {
    const messageBody = "This is the user's message";

    render(
      <IntlProvider locale="en" messages={{}}>
        <RateLimitReached message={message} body={messageBody} />
      </IntlProvider>,
      { wrapper: Tooltip.Provider }
    );

    const parsedText = screen.getByTestId('parsed-text');
    expect(parsedText).toBeInTheDocument();
    expect(parsedText).toHaveTextContent(messageBody);
  });

  it('renders the message body within a blockquote', () => {
    const messageBody = "User's blocked message";

    const { container } = render(
      <IntlProvider locale="en" messages={{}}>
        <RateLimitReached message={message} body={messageBody} />
      </IntlProvider>,
      { wrapper: Tooltip.Provider }
    );

    const blockquote = container.querySelector('blockquote');
    expect(blockquote).toBeInTheDocument();
    expect(blockquote).toContainElement(screen.getByTestId('parsed-text'));
  });

  it('uses custom translations when provided', () => {
    const customMessages = {
      'global.rateLimitReachedNodetitle': 'Limite de Taxa Atingido',
      'global.rateLimitReachedNodedescription': 'Esta mensagem foi enviada automaticamente porque o usuário atingiu o limite.',
      'global.time': 'Hora',
    };

    render(
      <IntlProvider locale="pt" messages={customMessages}>
        <RateLimitReached message={message} body="Mensagem do usuário" />
      </IntlProvider>,
      { wrapper: Tooltip.Provider }
    );

    expect(screen.getByText('Limite de Taxa Atingido')).toBeInTheDocument();
    expect(screen.getByText(/Esta mensagem foi enviada automaticamente/)).toBeInTheDocument();
  });
});
