import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { BulkConversationExport } from '@customTypes/conversation';

import { fetchLatestBulkConversationExport, requestBulkConversationExport } from '@services/ConversationsService';

import ExportHubConversations from './ExportHubConversations';

const toast = vi.fn();

vi.mock('@hooks/usePageTitle', () => ({ default: vi.fn() }));
vi.mock('@hooks/useToast', () => ({
  useToast: () => ({ toast }),
}));
vi.mock('@services/AdminService', () => ({
  fetchAdminHubs: vi.fn().mockResolvedValue([{ id: 3, name: 'Acme hub' }]),
}));
vi.mock('@services/ConversationsService', () => ({
  fetchLatestBulkConversationExport: vi.fn(),
  requestBulkConversationExport: vi.fn(),
}));

const buildExport = (overrides: Partial<BulkConversationExport> = {}): BulkConversationExport => ({
  id: 1,
  status: 'ready',
  created_at: '2026-11-12T10:00:00Z',
  expires_at: '2026-11-12T14:00:00Z',
  download_url: 'https://s3.example.com/export-1.csv',
  ...overrides,
});

const renderPage = (url = '/platform-admin/export-hub-conversations?hub_id=3') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <IntlProvider locale="en" messages={{}}>
          <ExportHubConversations />
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe('ExportHubConversations', () => {
  const { location } = window;
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('links back to the admin dashboard', () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(null);
    renderPage();

    expect(screen.getByRole('link', { name: 'Admin dashboard' })).toHaveAttribute('href', '/platform-admin');
  });

  it('asks for a hub before anything can be exported', () => {
    renderPage('/platform-admin/export-hub-conversations');

    expect(screen.getByText('Select a hub to export its conversations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeDisabled();
    expect(fetchLatestBulkConversationExport).not.toHaveBeenCalled();
  });

  it('shows an empty state when the hub has never been exported', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText('This hub’s conversations have not been exported yet')).toBeInTheDocument();
    expect(fetchLatestBulkConversationExport).toHaveBeenCalledWith(3);
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('requests an export and shows it as preparing', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(null);
    vi.mocked(requestBulkConversationExport).mockResolvedValue(buildExport({ status: 'pending', download_url: null }));
    renderPage();
    await screen.findByText('This hub’s conversations have not been exported yet');

    fireEvent.click(screen.getByRole('button', { name: 'Export conversations' }));

    expect(await screen.findByText('Preparing…')).toBeInTheDocument();
    expect(requestBulkConversationExport).toHaveBeenCalledWith(3);
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeDisabled();
  });

  it('shows an error toast when the export cannot be requested', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(null);
    vi.mocked(requestBulkConversationExport).mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('This hub’s conversations have not been exported yet');

    fireEvent.click(screen.getByRole('button', { name: 'Export conversations' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Could not start the export. Please try again.'));
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeEnabled();
  });

  it('polls a pending export until it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchLatestBulkConversationExport)
      .mockResolvedValueOnce(buildExport({ status: 'pending', download_url: null }))
      .mockResolvedValue(buildExport());
    renderPage();

    expect(await screen.findByText('Preparing…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('shows a ready export with when it stops being available, and allows a new export', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(buildExport());
    renderPage();

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Available until' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeEnabled();
  });

  it('downloads from a freshly fetched URL, not the one loaded earlier', async () => {
    vi.mocked(fetchLatestBulkConversationExport)
      .mockResolvedValueOnce(buildExport({ download_url: 'https://s3.example.com/old.csv' }))
      .mockResolvedValue(buildExport({ download_url: 'https://s3.example.com/fresh.csv' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://s3.example.com/fresh.csv'));
    expect(assign).not.toHaveBeenCalledWith('https://s3.example.com/old.csv');
  });

  it('disables the download button while a fresh URL is being fetched', async () => {
    vi.mocked(fetchLatestBulkConversationExport)
      .mockResolvedValueOnce(buildExport())
      .mockReturnValue(new Promise(() => {}));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled());
  });

  it('does not download the cached URL when fetching a fresh one fails, but keeps showing the export', async () => {
    vi.mocked(fetchLatestBulkConversationExport)
      .mockResolvedValueOnce(buildExport({ download_url: 'https://s3.example.com/old.csv' }))
      .mockRejectedValue(new Error('boom'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Could not download the export. Please try again.'));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the latest export.')).not.toBeInTheDocument();
  });

  it('shows a loading indicator while the latest export loads', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });

  it('treats a ready export without a URL as expired', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(buildExport({ download_url: null }));
    renderPage();

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeEnabled();
  });

  it('shows an expired export', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(buildExport({ status: 'expired', download_url: null }));
    renderPage();

    expect(await screen.findByText('Expired')).toBeInTheDocument();
  });

  it('shows a failed export and allows a new one', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockResolvedValue(buildExport({ status: 'failed', download_url: null }));
    renderPage();

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export conversations' })).toBeEnabled();
  });

  it('says when the latest export cannot be loaded', async () => {
    vi.mocked(fetchLatestBulkConversationExport).mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByText('Could not load the latest export.')).toBeInTheDocument();
  });
});
