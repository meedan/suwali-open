import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import MessageReportsExport from './MessageReportsExport';

const handleExport = vi.fn();

vi.mock('@hooks/usePageTitle', () => ({ default: vi.fn() }));
vi.mock('./useAdminExport', () => ({
  default: () => ({ exportingPath: null, error: null, handleExport }),
}));
const fetchAdminMessageReports = vi.fn();
vi.mock('@services/AdminService', () => ({
  fetchAdminHubs: vi.fn().mockResolvedValue([]),
  fetchAdminMessageReports: (...args: unknown[]) => fetchAdminMessageReports(...args),
}));

const report = {
  id: 1,
  hub_id: 7,
  hub_name: 'Acme hub',
  message_id: 99,
  message_link: 'https://app.example.com/hub/7/conversations/audience/3?messageId=99',
  platform: 'telegram',
  user_question: 'What is the deadline?',
  message_body: 'The deadline is Friday.',
  message_sent_at: '2026-11-01T09:00:00Z',
  reported_by_email: 'editor@example.com',
  comment: 'Wrong date',
  created_at: '2026-11-01T10:00:00Z',
};

const pageOf = (totalPages: number, data = [report]) => ({
  data,
  pagination: { current_page: 1, per_page: 50, total_pages: totalPages, total_count: data.length },
});

const renderPage = (url = '/') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <IntlProvider locale="en" messages={{}}>
          <MessageReportsExport />
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe('MessageReportsExport', () => {
  beforeEach(() => fetchAdminMessageReports.mockResolvedValue(pageOf(1)));

  it('exports reports from all hubs by default', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(handleExport).toHaveBeenCalledWith('/admin/export/message-reports', 'suwali-message-reports-export');
  });

  it('starts on the hub given in the link', async () => {
    renderPage('/platform-admin/message-reports?hub_id=7');
    await screen.findByText('The deadline is Friday.');
    expect(fetchAdminMessageReports).toHaveBeenCalledWith({ hubId: 7, page: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(handleExport).toHaveBeenCalledWith('/admin/export/message-reports?hub_id=7', 'suwali-message-reports-export-hub-7');
  });

  it('starts on the page given in the link', async () => {
    renderPage('/platform-admin/message-reports?hub_id=7&page=2');
    await screen.findByText('The deadline is Friday.');
    expect(fetchAdminMessageReports).toHaveBeenCalledWith({ hubId: 7, page: 2 });
  });

  it('ignores an invalid page in the link', async () => {
    renderPage('/platform-admin/message-reports?page=abc');
    await screen.findByText('The deadline is Friday.');
    expect(fetchAdminMessageReports).toHaveBeenCalledWith({ hubId: undefined, page: 1 });
  });

  it('links back to the admin dashboard', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Admin dashboard' })).toHaveAttribute('href', '/platform-admin');
  });

  it('lists reported messages in a table', async () => {
    renderPage();
    expect(await screen.findByText('The deadline is Friday.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme hub' })).toHaveAttribute('href', '/hub/7/dashboard');
    expect(screen.getByRole('link', { name: '99' })).toHaveAttribute('href', report.message_link);
    expect(screen.getByText('editor@example.com')).toBeInTheDocument();
    expect(screen.getByText('Wrong date')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been reported', async () => {
    fetchAdminMessageReports.mockResolvedValue(pageOf(0, []));
    renderPage();
    expect(await screen.findByText('No messages have been reported')).toBeInTheDocument();
  });

  it('goes to the next page', async () => {
    fetchAdminMessageReports.mockResolvedValue(pageOf(2));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(fetchAdminMessageReports).toHaveBeenLastCalledWith({ hubId: undefined, page: 2 });
  });
});
