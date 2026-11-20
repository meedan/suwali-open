import { IntlProvider } from 'react-intl';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import { APP_NAME } from '@constants/App';

import { fetchSources } from '@services/SourcesService';

import DataSourcesMain from './DataSourcesMain';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@services/SourcesService', () => ({ fetchSources: vi.fn() }));

vi.mock('@hooks/useRememberedSearchParams', () => ({ useNavigateWithRememberedParams: () => vi.fn() }));

// Layout pulls in the hub, the account menu and the top navigation, which none of this depends on
vi.mock('@ui-components/layout/Layout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Left = ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>;
  Layout.Main = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return { Layout };
});

// The panels and wizards are covered on their own; here they only need to show which source is
// open, and to report a saved source back the way the real wizards do
vi.mock('./DataSourcesSidebar', () => ({ default: () => null }));
vi.mock('./DataSourcesSummariesPanel', () => ({ default: () => null }));
vi.mock('./DataSourcesContributionsPanel', () => ({ default: () => null }));
vi.mock('./DataSourcesContributionsSettings', () => ({ default: () => null }));
vi.mock('./DataSourcesDocumentsPanel', () => ({
  default: ({ source }: { source: Source }) => <div>{`Documents of ${source.name}`}</div>,
}));
vi.mock('./DataSourcesCreateWizard', () => ({
  default: ({ onCreate, onTypeChange }: { onCreate: (sourceId: number) => void; onTypeChange: (type: string) => void }) => (
    <>
      <button onClick={() => onCreate(createdSource.id)}>Create source</button>
      <button onClick={() => onTypeChange('wordpress_api')}>Pick WordPress</button>
    </>
  ),
}));
vi.mock('./DataSourcesSettings', () => ({
  default: ({ source, onCreate }: { source: Source; onCreate: (sourceId: number) => void }) => (
    <button onClick={() => onCreate(source.id)}>Save source</button>
  ),
}));

const existingSource: Source = { id: 1, name: 'Existing', config: {}, documents_count: 0, updated_at: '', source_type: 'website' };
const createdSource: Source = { id: 2, name: 'Created', config: {}, documents_count: 0, updated_at: '', source_type: 'website' };

const Path = () => <span data-testid="path">{useLocation().pathname}</span>;
const path = () => screen.getByTestId('path').textContent;

// The refetch that follows a save is held open, so the test can look at the page while the
// sources list is still stale, which is exactly when navigating to a new source used to go wrong
const holdRefetch = () => {
  let resolve: (sources: Source[]) => void = () => {};
  vi.mocked(fetchSources).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  return (sources: Source[]) => resolve(sources);
};

const renderAt = async (initialPath: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/hub/1/data-sources/:sourceId" element={<DataSourcesMain />} />
            <Route path="/hub/1/data-sources/:sourceId/settings" element={<DataSourcesMain activeAssetType="settings" />} />
            <Route path="/hub/1/data-sources/new" element={<DataSourcesMain activeAssetType="new" />} />
          </Routes>
          <Path />
          <Link to="/hub/1/data-sources/1">Open source</Link>
          <Link to="/hub/1/data-sources/new">Add source</Link>
        </MemoryRouter>
      </IntlProvider>
    </QueryClientProvider>
  );

  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
};

describe('DataSourcesMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('opens a newly created source only once the sources list includes it', async () => {
    vi.mocked(fetchSources).mockResolvedValueOnce([existingSource]);
    await renderAt('/hub/1/data-sources/new');

    const finishRefetch = holdRefetch();
    fireEvent.click(screen.getByRole('button', { name: 'Create source' }));

    await waitFor(() => expect(fetchSources).toHaveBeenCalledTimes(2));
    // Opening it now would find no such source and fall back to the first one in the list
    expect(path()).toBe('/hub/1/data-sources/new');

    finishRefetch([existingSource, createdSource]);

    await waitFor(() => expect(path()).toBe('/hub/1/data-sources/2'));
    expect(await screen.findByText('Documents of Created')).toBeInTheDocument();
  });

  it('goes back to the source with its refreshed details after saving its settings', async () => {
    vi.mocked(fetchSources).mockResolvedValueOnce([existingSource]);
    await renderAt('/hub/1/data-sources/1/settings');

    const finishRefetch = holdRefetch();
    fireEvent.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() => expect(fetchSources).toHaveBeenCalledTimes(2));
    expect(path()).toBe('/hub/1/data-sources/1/settings');

    finishRefetch([{ ...existingSource, name: 'Renamed' }]);

    await waitFor(() => expect(path()).toBe('/hub/1/data-sources/1'));
    expect(await screen.findByText('Documents of Renamed')).toBeInTheDocument();
  });

  describe('browser page title', () => {
    const title = (name: string) => `${name} | ${APP_NAME}`;

    it('says a source is being added, and which kind once it is picked', async () => {
      vi.mocked(fetchSources).mockResolvedValueOnce([existingSource]);
      await renderAt('/hub/1/data-sources/new');
      expect(document.title).toBe(title('New data source'));

      fireEvent.click(screen.getByRole('button', { name: 'Pick WordPress' }));

      await waitFor(() => expect(document.title).toBe(title('New WordPress site')));
    });

    it('is the name of the open source', async () => {
      vi.mocked(fetchSources).mockResolvedValueOnce([existingSource]);
      await renderAt('/hub/1/data-sources/1');

      await waitFor(() => expect(document.title).toBe(title('Existing')));
    });

    it('forgets the picked kind after leaving the new source page', async () => {
      vi.mocked(fetchSources).mockResolvedValueOnce([existingSource]);
      await renderAt('/hub/1/data-sources/new');
      fireEvent.click(screen.getByRole('button', { name: 'Pick WordPress' }));
      await waitFor(() => expect(document.title).toBe(title('New WordPress site')));

      fireEvent.click(screen.getByRole('link', { name: 'Open source' }));
      await waitFor(() => expect(document.title).toBe(title('Existing')));

      fireEvent.click(screen.getByRole('link', { name: 'Add source' }));
      await waitFor(() => expect(document.title).toBe(title('New data source')));
    });
  });
});
