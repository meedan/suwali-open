import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import { deleteNotebook } from '@services/NotebooksService';

import { ToastProvider } from '@hooks/useToast';

import NotebooksSidebar from './NotebooksSidebar';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@hooks/useHubPath', () => ({ useHubPath: () => (path: string) => path }));

vi.mock('@services/NotebooksService', () => ({
  createNotebook: vi.fn(),
  deleteNotebook: vi.fn(),
}));

vi.mock('@components/Can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const notebook = (id: number) => ({ id, hub_id: 1, user_id: 10, name: `Notebook ${id}`, published: false }) as Notebook;
const notebooks = [notebook(1), notebook(2), notebook(3)];

const LocationProbe = () => <div data-testid="location">{useLocation().pathname}</div>;

const renderSidebar = (props: Partial<React.ComponentProps<typeof NotebooksSidebar>> = {}) =>
  render(
    <MemoryRouter initialEntries={[`/notebooks/${props.selectedNotebook?.id ?? ''}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastPrimitive.Provider>
              <ToastProvider>
                <NotebooksSidebar
                  notebooks={notebooks}
                  refetchAroundId={vi.fn().mockResolvedValue(undefined)}
                  onNotebookSelect={vi.fn()}
                  {...props}
                />
                <LocationProbe />
              </ToastProvider>
            </ToastPrimitive.Provider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

const removeNotebook = (index: number) => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove notebook' })[index]);
  fireEvent.click(within(screen.getByRole('dialog', { name: /Remove notebook\?/ })).getByRole('button', { name: 'Remove notebook' }));
};

describe('NotebooksSidebar', () => {
  beforeEach(() => {
    vi.mocked(deleteNotebook).mockReset().mockResolvedValue({ message: 'Notebook deleted' });
  });

  it.each([
    ['the next one', 2, 3],
    ['the previous one when it was last', 3, 2],
  ])('opens %s after removing the open notebook', async (_case, removedId, nextId) => {
    const onNotebookSelect = vi.fn();
    const refetchAroundId = vi.fn().mockResolvedValue(undefined);
    renderSidebar({ selectedNotebook: notebook(removedId), onNotebookSelect, refetchAroundId });

    removeNotebook(removedId - 1);

    await waitFor(() => expect(onNotebookSelect).toHaveBeenCalledWith(expect.objectContaining({ id: nextId }), true));
    expect(deleteNotebook).toHaveBeenCalledWith(removedId);
    expect(refetchAroundId).toHaveBeenCalledWith(nextId);
  });

  it('returns to the notebooks list after removing the only notebook', async () => {
    const onNotebookSelect = vi.fn();
    renderSidebar({ notebooks: [notebook(1)], selectedNotebook: notebook(1), onNotebookSelect });

    removeNotebook(0);

    await waitFor(() => expect(deleteNotebook).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/notebooks$/));
    expect(onNotebookSelect).not.toHaveBeenCalled();
  });

  it('keeps the open notebook when removing another one', async () => {
    const onNotebookSelect = vi.fn();
    renderSidebar({ selectedNotebook: notebook(1), onNotebookSelect });

    removeNotebook(1);

    await waitFor(() => expect(deleteNotebook).toHaveBeenCalledWith(2));
    expect(onNotebookSelect).not.toHaveBeenCalled();
  });
});
