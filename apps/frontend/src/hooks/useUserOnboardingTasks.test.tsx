import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import * as ProfileService from '@services/ProfileService';

import * as SessionContext from '@root/SessionContext';

import { useUserOnboardingTasks } from './useUserOnboardingTasks';

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

vi.mock('@services/ProfileService');

const TestComponent = () => {
  const { internalConversationStarted, isPending } = useUserOnboardingTasks();
  return <span>{JSON.stringify({ internalConversationStarted, isPending })}</span>;
};

const renderComponent = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TestComponent />
    </QueryClientProvider>
  );

describe('useUserOnboardingTasks', () => {
  it.each([null, 0])('reports isPending as false when the current hub id is %s, instead of hanging indefinitely', (hubId) => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => hubId,
    } as ReturnType<typeof SessionContext.useSession>);

    renderComponent();

    expect(screen.getByText(/"isPending":false/)).toBeInTheDocument();
    expect(ProfileService.fetchMe).not.toHaveBeenCalled();
  });

  it('reports isPending as true while a current hub exists and /me is still loading', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(ProfileService.fetchMe).mockReturnValue(new Promise(() => {}));

    renderComponent();

    expect(screen.getByText(/"isPending":true/)).toBeInTheDocument();
  });
});
