import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import * as NotebooksService from '@services/NotebooksService';

import { useCan } from '@hooks/useCapabilities';
import { ToastProvider } from '@hooks/useToast';

import AddToNotebookModal from './AddToNotebookModal';

const mockNavigate = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@services/NotebooksService', () => ({
  fetchNotebooks: vi.fn(),
  fetchNotebookItems: vi.fn(),
  createNotebook: vi.fn(),
  mutateAddToNotebook: vi.fn(),
  mutateRemoveFromNotebook: vi.fn(),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@ui-components/layout/Icon', () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

vi.mock('@ui-components/layout/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, titleContext, body, actions, open }: {
    title?: React.ReactNode;
    titleContext?: React.ReactNode;
    body: React.ReactNode;
    actions?: React.ReactNode;
    open?: boolean;
  }) => (
    open ? (
      <dialog open>
        <div>{titleContext}</div>
        <div>{title}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    ) : null
  ),
}));

const notebookOne = { id: 1, name: 'Notebook One' };
const notebookTwo = { id: 2, name: 'Notebook Two' };

const notebookItem = { id: 501, item_id: 10, item_type: 'Document', notebook_id: 1, updated_at: '2026-01-01T00:00:00Z' };

const renderModal = (props: Partial<React.ComponentProps<typeof AddToNotebookModal>> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <AddToNotebookModal
              assetId={10}
              assetTitle="My document"
              assetType="Document"
              open
              onOpenChange={onOpenChange}
              {...props}
            />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
  return { queryClient, onOpenChange };
};

describe('AddToNotebookModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(NotebooksService.fetchNotebooks).mockResolvedValue({ data: [notebookOne, notebookTwo] } as unknown as NotebooksService.NotebooksResponse);
    vi.mocked(NotebooksService.fetchNotebookItems).mockResolvedValue([notebookItem] as unknown as NotebooksService.AssetNotebookItem[]);
    vi.mocked(NotebooksService.mutateAddToNotebook).mockResolvedValue({} as unknown as NotebooksService.AddToNotebookResponse);
    vi.mocked(NotebooksService.mutateRemoveFromNotebook).mockResolvedValue({} as unknown as NotebooksService.DeleteResponse);
    vi.mocked(NotebooksService.createNotebook).mockResolvedValue({ id: 3, name: 'Untitled notebook' } as unknown as Notebook);
    vi.mocked(useCan).mockReturnValue({ allowed: true });
  });

  it('renders nothing while the notebooks and notebook items are still loading', () => {
    vi.mocked(NotebooksService.fetchNotebooks).mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no asset to add to a notebook', () => {
    renderModal({ assetId: undefined });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and asset context for the given asset type', async () => {
    renderModal({ assetType: 'Document', assetTitle: 'My document' });
    expect(await screen.findByText('Include document in notebooks')).toBeInTheDocument();
    expect(screen.getByText('My document')).toBeInTheDocument();
    expect(screen.getByTestId('icon-document')).toBeInTheDocument();
  });

  it('renders without a title for note assets, without crashing', async () => {
    renderModal({ assetType: 'Note' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('icon-note')).toBeInTheDocument();
  });

  it('lists each notebook as a checkbox, pre-checked for notebooks the asset already belongs to', async () => {
    renderModal();
    await screen.findByRole('dialog');
    expect(screen.getByRole('checkbox', { name: 'Notebook One' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Notebook Two' })).not.toBeChecked();
  });

  it('excludes the notebook itself from its own list when adding a notebook summary to notebooks', async () => {
    renderModal({ assetType: 'Notebook', assetId: 1 });
    await screen.findByRole('dialog');
    expect(screen.queryByRole('checkbox', { name: 'Notebook One' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Notebook Two' })).toBeInTheDocument();
  });

  it('shows "No changes" until a selection actually changes, and reverts once it is toggled back', async () => {
    renderModal();
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'No changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    expect(screen.getByRole('button', { name: 'Include in (2) notebooks' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    expect(screen.getByRole('button', { name: 'No changes' })).toBeInTheDocument();
  });

  it('shows the notebook count when multiple notebooks end up selected', async () => {
    renderModal();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    expect(screen.getByRole('button', { name: 'Include in (2) notebooks' })).toBeInTheDocument();
  });

  it('shows "Remove from all notebooks" when unchecking the only notebook the asset belongs to', async () => {
    renderModal();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook One' }));
    expect(screen.getByRole('button', { name: 'Remove from all notebooks' })).toBeInTheDocument();
  });

  it('shows the "Create new notebook" option when the hub has the CREATE_NOTEBOOK capability', async () => {
    renderModal();
    await screen.findByRole('dialog');
    expect(screen.getByRole('checkbox', { name: 'Create new notebook' })).not.toBeChecked();
  });

  it('hides the "Create new notebook" option without the CREATE_NOTEBOOK capability', async () => {
    vi.mocked(useCan).mockReturnValue({ allowed: false });
    renderModal();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('checkbox', { name: 'Create new notebook' })).not.toBeInTheDocument();
  });

  it('counts the new notebook in the submit label without creating it yet', async () => {
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Create new notebook' }));

    expect(screen.getByRole('button', { name: 'Include in (2) notebooks' })).toBeInTheDocument();
    expect(NotebooksService.createNotebook).not.toHaveBeenCalled();
  });

  it('creates the notebook on submit, adds the asset to it, and resets the option', async () => {
    const { onOpenChange } = renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Create new notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include in (2) notebooks' }));

    await waitFor(() => {
      expect(NotebooksService.mutateAddToNotebook).toHaveBeenCalledWith('3', 10, 'Document');
    });
    expect(NotebooksService.createNotebook).toHaveBeenCalledWith({
      notebook: { hub_id: 1, name: 'Untitled notebook' },
    });
    // The toast names the new notebook and links to it, even though it wasn't in the list the modal loaded
    expect(await screen.findByText('Untitled notebook')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View notebook' })).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('checkbox', { name: 'Create new notebook' })).not.toBeChecked();
  });

  it('does not create a second notebook when submit is clicked again while the first is being created', async () => {
    let resolveCreate: (notebook: Notebook) => void = () => {};
    vi.mocked(NotebooksService.createNotebook).mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Create new notebook' }));
    const submitButton = screen.getByRole('button', { name: 'Include in (2) notebooks' });
    fireEvent.click(submitButton);
    await waitFor(() => expect(submitButton).toBeDisabled());
    fireEvent.click(submitButton);

    resolveCreate({ id: 3, name: 'Untitled notebook' } as unknown as Notebook);

    await waitFor(() => expect(submitButton).toBeEnabled());
    expect(NotebooksService.createNotebook).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when creating a notebook fails, and still applies the other changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(NotebooksService.createNotebook).mockRejectedValue(new Error('boom'));
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create new notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include in (3) notebooks' }));

    await screen.findByText('There was an error creating the notebook. Please try again.');
    await waitFor(() => {
      expect(NotebooksService.mutateAddToNotebook).toHaveBeenCalledWith('2', 10, 'Document');
    });
    expect(NotebooksService.mutateAddToNotebook).toHaveBeenCalledTimes(1);
  });

  it('adds newly checked notebooks and removes newly unchecked ones on submit, then closes the modal', async () => {
    const { onOpenChange } = renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook One' })); // was checked, now unchecking
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' })); // was unchecked, now checking

    fireEvent.click(screen.getByRole('button', { name: 'Include in (1) notebook' }));

    await waitFor(() => {
      expect(NotebooksService.mutateAddToNotebook).toHaveBeenCalledWith('2', 10, 'Document');
    });
    expect(NotebooksService.mutateRemoveFromNotebook).toHaveBeenCalledWith('1', 501);

    await screen.findByText('Added to notebook');
    await screen.findByText('Removed from notebook');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an error toast when adding to a notebook fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(NotebooksService.mutateAddToNotebook).mockRejectedValue(new Error('boom'));
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include in (2) notebooks' }));

    await screen.findByText('Failed to update notebook');
  });

  it('closes without submitting anything when Cancel is clicked', async () => {
    const { onOpenChange } = renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(NotebooksService.mutateAddToNotebook).not.toHaveBeenCalled();
    expect(NotebooksService.mutateRemoveFromNotebook).not.toHaveBeenCalled();
  });

  it('navigates to the notebook when its "View notebook" toast action is clicked', async () => {
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notebook Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include in (2) notebooks' }));

    fireEvent.click(await screen.findByRole('button', { name: 'View notebook' }));
    expect(mockNavigate).toHaveBeenCalledWith('/hub/1/notebooks/2');
  });

  it('opens a notebook in a new tab when its external link button is clicked', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getAllByTestId('icon-arrow_square_out')[0].closest('button')!);

    expect(openSpy).toHaveBeenCalledWith('/hub/1/notebooks/1', '_blank', 'noopener,noreferrer');
  });
});
