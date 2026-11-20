import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import type { CanDecision } from '@customTypes/hub';

import * as SessionContext from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';

import { useSetupWidgetState } from './useSetupWidgetState';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: vi.fn(),
}));

vi.mock('@hooks/useHubSetupTasks', () => ({
  useHubSetupTasks: vi.fn(),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));

const setCapabilities = ({
  canUpdateHub = true,
  messagingAllowed = true,
  messagingReasons,
}: {
  canUpdateHub?: boolean;
  messagingAllowed?: boolean;
  messagingReasons?: string[];
} = {}) => {
  vi.mocked(useCan).mockImplementation((action): CanDecision => {
    if (action === 'UPDATE_HUB') return { allowed: canUpdateHub };
    if (action === 'MANAGE_MESSAGING_INTEGRATION') return { allowed: messagingAllowed, reasons: messagingReasons };
    return { allowed: true };
  });
};

const setSetupTasks = ({ contentAdded = true, isPending = false }: { contentAdded?: boolean; isPending?: boolean } = {}) => {
  vi.mocked(useHubSetupTasks).mockReturnValue({
    ownSourceCreated: contentAdded,
    ownDocumentSynced: contentAdded,
    isPending,
  } as ReturnType<typeof useHubSetupTasks>);
};

const setIntegrationsQuery = ({
  data,
  isPending = false,
  error = null,
}: {
  data?: unknown[];
  isPending?: boolean;
  error?: unknown;
} = {}) => {
  vi.mocked(useQuery).mockReturnValue({
    data,
    isPending,
    error,
    status: error ? 'error' : 'success',
  } as UseQueryResult<unknown, unknown>);
};

const TestComponent = () => {
  const state = useSetupWidgetState();
  return <span>{JSON.stringify(state)}</span>;
};

const renderHook = () => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHubId: () => 1,
  } as ReturnType<typeof SessionContext.useSession>);

  return render(<TestComponent />);
};

describe('useSetupWidgetState', () => {
  it('reports pending while the hub setup tasks are still loading', () => {
    setCapabilities();
    setSetupTasks({ isPending: true });
    setIntegrationsQuery();

    renderHook();

    expect(screen.getByText('{"type":"pending"}')).toBeInTheDocument();
  });

  it('reports pending while the messaging integrations query is still loading', () => {
    setCapabilities();
    setSetupTasks();
    setIntegrationsQuery({ isPending: true });

    renderHook();

    expect(screen.getByText('{"type":"pending"}')).toBeInTheDocument();
  });

  it('reports error when the messaging integrations query fails', () => {
    setCapabilities();
    setSetupTasks();
    setIntegrationsQuery({ error: new Error('boom') });

    renderHook();

    expect(screen.getByText('{"type":"error","error":{}}')).toBeInTheDocument();
  });

  it('reports continueSetup when the admin has not finished adding content, even if integrations are already connected', () => {
    setCapabilities({ canUpdateHub: true });
    setSetupTasks({ contentAdded: false });
    setIntegrationsQuery({ data: [{ id: 1, active: true }] });

    renderHook();

    expect(screen.getByText('{"type":"continueSetup"}')).toBeInTheDocument();
  });

  it('does not prompt to continue setup for a non-admin whose content is incomplete', () => {
    setCapabilities({ canUpdateHub: false, messagingAllowed: true });
    setSetupTasks({ contentAdded: false });
    setIntegrationsQuery({ data: [] });

    renderHook();

    expect(screen.getByText('{"type":"goLive","trialExpired":false}')).toBeInTheDocument();
  });

  it('reports hidden when there are no integrations, the user cannot manage them, and the trial has not expired', () => {
    setCapabilities({ messagingAllowed: false, messagingReasons: [] });
    setSetupTasks();
    setIntegrationsQuery({ data: [] });

    renderHook();

    expect(screen.getByText('{"type":"hidden"}')).toBeInTheDocument();
  });

  it('reports goLive with trialExpired when there are no integrations because the trial ended', () => {
    setCapabilities({ messagingAllowed: false, messagingReasons: ['trial_expired'] });
    setSetupTasks();
    setIntegrationsQuery({ data: [] });

    renderHook();

    expect(screen.getByText('{"type":"goLive","trialExpired":true}')).toBeInTheDocument();
  });

  it('reports goLive without trialExpired when messaging is allowed but nothing is connected yet', () => {
    setCapabilities({ messagingAllowed: true });
    setSetupTasks();
    setIntegrationsQuery({ data: [] });

    renderHook();

    expect(screen.getByText('{"type":"goLive","trialExpired":false}')).toBeInTheDocument();
  });

  it('reports only active integrations once something is connected', () => {
    setCapabilities();
    setSetupTasks();
    setIntegrationsQuery({
      data: [
        { id: 1, active: true },
        { id: 2, active: false },
      ],
    });

    renderHook();

    expect(screen.getByText('{"type":"integrations","integrations":[{"id":1,"active":true}]}')).toBeInTheDocument();
  });
});
