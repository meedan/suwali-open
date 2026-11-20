import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import type { Hub } from '@customTypes/hub';

import * as HubService from '@services/HubService';

import * as SessionContext from '@root/SessionContext';

import { useHubSetupTasks } from './useHubSetupTasks';

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

vi.mock('@services/HubService');

const TestComponent = () => {
  const { sourceCreated, documentSynced, isPending } = useHubSetupTasks();
  return <span>{JSON.stringify({ sourceCreated, documentSynced, isPending })}</span>;
};

const renderComponent = () => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TestComponent />
    </QueryClientProvider>
  );
};

describe('useHubSetupTasks', () => {
  it('reports isPending as false when there is no current hub, instead of hanging indefinitely', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => null,
    } as ReturnType<typeof SessionContext.useSession>);

    renderComponent();

    expect(screen.getByText(/"isPending":false/)).toBeInTheDocument();
    expect(HubService.fetchHub).not.toHaveBeenCalled();
  });

  it('reports isPending as true while a current hub exists and its data is still loading', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(HubService.fetchHub).mockReturnValue(new Promise(() => {}));

    renderComponent();

    expect(screen.getByText(/"isPending":true/)).toBeInTheDocument();
  });

  it('derives task flags from the fetched hub once loaded', async () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(HubService.fetchHub).mockResolvedValue({
      onboarding_tasks: {
        source_created: true,
        document_synced: false,
        internal_conversation_message_received: false,
        messaging_platform_connected: false,
      },
    } as unknown as Hub);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/"sourceCreated":true/)).toBeInTheDocument();
    });
    expect(screen.getByText(/"documentSynced":false/)).toBeInTheDocument();
    expect(screen.getByText(/"isPending":false/)).toBeInTheDocument();
  });
});
