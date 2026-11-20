import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import { getLastPath, setLastPath } from '@helpers/lastPath';

import { fetchItems, fetchNotebooksPaginated, fetchNotebookSummary } from '@services/NotebooksService';

import { HttpError } from '@root/NetworkLayer';

import NotebooksMain from './NotebooksMain';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1, hubUnavailable: () => false, user: { id: 10 } }),
}));

vi.mock('@services/NotebooksService', () => ({
  fetchItems: vi.fn(),
  fetchNotebookSummary: vi.fn(),
  fetchNotebooksPaginated: vi.fn(),
  updateNotebook: vi.fn(),
}));

vi.mock('@hooks/usePageTitle', () => ({ default: () => undefined }));
vi.mock('@hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@hooks/useDataSourceItemActions', () => ({ useDataSourceItemActions: () => ({}) }));

// Layout pulls in the hub, the account menu and the top navigation, which none of this depends on
vi.mock('@ui-components/layout/Layout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Left = ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>;
  Layout.Main = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return { Layout };
});

// Publishing, pausing and renaming all end with this refetch
vi.mock('./NotebookSummaryPanel', () => ({
  default: ({ notebookId, refetchAroundId }: { notebookId: number; refetchAroundId: () => void }) => (
    <article>
      {`Open notebook ${notebookId}`}
      <button onClick={refetchAroundId}>Publish</button>
    </article>
  ),
}));

vi.mock('./NotebookSidebar', () => ({ default: () => null }));

vi.mock('./NotebooksSidebar', () => ({
  default: ({ notebooks, onJumpToTop }: { notebooks: Notebook[]; onJumpToTop?: () => void }) => (
    <>
      {onJumpToTop && <button onClick={onJumpToTop}>Jump to top</button>}
      <ul>
        {notebooks.map((notebook) => <li key={notebook.id}>{`Notebook ${notebook.id}`}</li>)}
      </ul>
    </>
  ),
}));

const notebook = (id: number, overrides: Partial<Notebook> = {}) => ({ id, hub_id: 1, user_id: 10, name: `Notebook ${id}`, ...overrides }) as Notebook;

const Path = () => <span data-testid="path">{useLocation().pathname}</span>;
const path = () => screen.getByTestId('path').textContent;

const renderAt = (initialPath: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/hub/1/notebooks" element={<NotebooksMain />} />
            <Route path="/hub/1/notebooks/:notebookId" element={<NotebooksMain />} />
          </Routes>
          <Path />
        </MemoryRouter>
      </IntlProvider>
    </QueryClientProvider>
  );
  return queryClient;
};

describe('NotebooksMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // The window around a notebook further down the list, or the first window after a jump to the top
    vi.mocked(fetchNotebooksPaginated).mockImplementation(async (_hubId, aroundId) => ({
      data: (aroundId && aroundId >= 8 ? [8, 9] : [1, 2]).map((id) => notebook(id)),
      pagination: { has_previous: Boolean(aroundId && aroundId >= 8), has_next: false, target_record_id: aroundId ?? 1 },
    }) as unknown as Awaited<ReturnType<typeof fetchNotebooksPaginated>>);
    vi.mocked(fetchNotebookSummary).mockImplementation(async (id) => {
      if (id === 99) throw new HttpError(404, {}, new Headers());
      if (id === 98) return notebook(98, { user_id: 11, published: true });
      return notebook(id!);
    });
    vi.mocked(fetchItems).mockResolvedValue([]);
  });

  it('keeps the selected notebook open when jumping to the top of the list', async () => {
    renderAt('/hub/1/notebooks/9');
    await screen.findByText('Open notebook 9');

    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));

    await screen.findByText('Notebook 1');
    expect(screen.getByText('Open notebook 9')).toBeInTheDocument();
    expect(path()).toBe('/hub/1/notebooks/9');
  });

  it('keeps the list at the top when the open notebook is edited after a jump', async () => {
    renderAt('/hub/1/notebooks/9');
    await screen.findByText('Open notebook 9');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));
    await screen.findByText('Notebook 1');

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(fetchNotebooksPaginated).toHaveBeenLastCalledWith(1, 2, expect.anything()));
    expect(screen.getByText('Notebook 1')).toBeInTheDocument();
    expect(screen.queryByText('Notebook 8')).not.toBeInTheDocument();
  });

  it.each([
    ['is missing or hidden', 99],
    ['is a colleague’s published notebook', 98],
  ])('shows not found beside the list when the linked notebook %s', async (_case, notebookId) => {
    setLastPath('notebooksLastPath', 1, `/notebooks/${notebookId}`);
    renderAt(`/hub/1/notebooks/${notebookId}`);

    expect(await screen.findByRole('heading', { name: 'This content is not available' })).toBeInTheDocument();
    expect(screen.getByText('Notebook 8')).toBeInTheDocument();
    expect(path()).toBe(`/hub/1/notebooks/${notebookId}`);
    expect(getLastPath('notebooksLastPath', 1)).toBeNull();
  });

  it('shows not found when the open notebook is removed after the list moved past it', async () => {
    const queryClient = renderAt('/hub/1/notebooks/9');
    await screen.findByText('Open notebook 9');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));
    await screen.findByText('Notebook 1');

    vi.mocked(fetchNotebookSummary).mockRejectedValue(new HttpError(404, {}, new Headers()));
    await act(() => queryClient.invalidateQueries({ queryKey: ['/notebooks/9'] }));

    expect(await screen.findByRole('heading', { name: 'This content is not available' })).toBeInTheDocument();
    expect(screen.queryByText('Open notebook 9')).not.toBeInTheDocument();
  });
});
