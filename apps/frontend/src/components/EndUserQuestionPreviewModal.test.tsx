import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import type { ClusterMessage, MessageCluster } from '@customTypes/message-cluster';

import * as MessageClustersService from '@services/MessageClustersService';

import EndUserQuestionPreviewModal from './EndUserQuestionPreviewModal';

vi.mock('@services/MessageClustersService', () => ({
  fetchClusterMessages: vi.fn(),
}));

vi.mock('./ViewConversationButton', () => ({
  default: ({ messageId }: { messageId?: number }) => <button>View full conversation {messageId}</button>,
}));

vi.mock('./PreviewModalBase', () => ({
  default: ({ title, details, actions, content }: { title: string; details: React.ReactNode; actions: React.ReactNode; content: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="details">{details}</div>
      <div data-testid="actions">{actions}</div>
      <div data-testid="content">{content}</div>
    </div>
  ),
}));

const cluster: MessageCluster = {
  id: 1,
  original_text: 'What is love?',
  question_count: 42,
  centroid_message_id: 10,
  last_message_body: 'What is love?',
};

const clusterMessage = {
  id: 20,
  body: 'What would you say is love?',
  reply: null,
  created_at: '2024-06-15T10:30:00Z',
  conversation: {
    platform: 'whatsapp',
    participant: {
      type: 'ExternalUser',
      name: 'Alice',
      trusted_user: true,
    },
  },
} as ClusterMessage;

const makeResponse = (messages: ClusterMessage[], total_count = messages.length) => ({
  data: messages,
  pagination: { current_page: 1, per_page: 1, total_pages: total_count, total_count, next_page: null, prev_page: null, first_page: true, last_page: true },
});

const renderModal = (props: Partial<React.ComponentProps<typeof EndUserQuestionPreviewModal>> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <Tooltip.Provider>
          <EndUserQuestionPreviewModal
            cluster={cluster}
            answered={false}
            open={true}
            onOpenChange={vi.fn()}
            {...props}
          />
        </Tooltip.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('EndUserQuestionPreviewModal', () => {
  beforeEach(() => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue({
      data: [],
      pagination: { current_page: 1, total_pages: 1, total_count: 0, per_page: 1, next_page: null, prev_page: null, first_page: true, last_page: true },
    });
  });

  it('renders nothing when cluster is null', () => {
    const { container } = renderModal({ cluster: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the question text', async () => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue(makeResponse([clusterMessage]));

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('What would you say is love?')).toBeInTheDocument();
    });
  });

  it('renders the page count from pagination', async () => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue(makeResponse([clusterMessage], 5));

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('actions')).toHaveTextContent('1 of 5');
    });
  });

  it('renders "Unanswered" title when answered is false', () => {
    renderModal({ answered: false });
    expect(screen.getByRole('heading', { name: 'Unanswered end-user question' })).toBeInTheDocument();
  });

  it('renders "Answered" title when answered is true', () => {
    renderModal({ answered: true });
    expect(screen.getByRole('heading', { name: 'Answered end-user question' })).toBeInTheDocument();
  });

  it('renders message details when message is loaded', async () => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue(makeResponse([clusterMessage]));

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('details')).toHaveTextContent('Alice');
      expect(screen.getByTestId('details')).toHaveTextContent('WhatsApp');
      expect(screen.getByTestId('details')).toHaveTextContent('Yes');
    });
  });

  it('renders the bot reply when the message has a reply', async () => {
    const messageWithReply: ClusterMessage = {
      ...clusterMessage,
      reply: { id: 11, body: 'No one really knows.', created_at: '2024-06-15T10:31:00Z' },
    };
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue(makeResponse([messageWithReply]));

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('No one really knows.')).toBeInTheDocument();
    });
  });

  it('renders the message date when message is loaded', async () => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockResolvedValue(makeResponse([clusterMessage]));

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('content')).toHaveTextContent('Jun');
    });
  });

  it('does not render dates while loading', () => {
    vi.mocked(MessageClustersService.fetchClusterMessages).mockReturnValue(new Promise(() => {}));

    renderModal();

    // Date header and timestamps should not appear while loading
    expect(screen.getByTestId('content')).not.toHaveTextContent('Jun');
  });
});
