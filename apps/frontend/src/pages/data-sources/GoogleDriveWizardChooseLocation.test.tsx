import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import * as googleDriveConnect from '@helpers/googleDriveConnect';

import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import GoogleDriveWizardChooseLocation from './GoogleDriveWizardChooseLocation';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));
vi.mock('@helpers/googleDriveConnect', async () => ({
  ...(await vi.importActual('@helpers/googleDriveConnect')),
  pickDriveParentFolder: vi.fn(),
  createFolderWithFiles: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock('@root/SessionContext');
vi.mock('@services/SourcesService');
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const setWizardState = vi.fn();
const onCancel = vi.fn();

const pickedFiles = [
  { id: 'file1', name: 'report.pdf' },
  { id: 'file2', name: 'faq.docx' },
];

const connectedFolder = {
  id: 'folder123',
  name: 'My Hub - Suwali Files',
  url: 'https://drive.google.com/drive/folders/folder123',
};

const defaultProps = {
  isEditing: false,
  isSetup: false,
  onCancel,
  onCreate: vi.fn(),
  onStepChange: vi.fn(),
  currentStep: 1,
  wizardState: { pickedFiles, accessToken: 'token-1' },
  setWizardState,
};

const aboutData = {
  google_drive_share_email: 'services@example.iam.gserviceaccount.com',
  google_oauth_client_id: 'client-1',
  google_picker_api_key: 'key-1',
  google_picker_app_id: '12345',
  max_file_size: '10 MB',
  max_files_per_upload: 20,
  allowed_extensions: 'PDF',
};

const renderComponent = (props = {}) => render(
  <QueryClientProvider client={new QueryClient()}>
    <IntlProvider locale="en" messages={{}}>
      <ToastProvider>
        <GoogleDriveWizardChooseLocation {...defaultProps} {...props} />
      </ToastProvider>
    </IntlProvider>
  </QueryClientProvider>
);

describe('GoogleDriveWizardChooseLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue({
      data: aboutData,
      isPending: false,
    } as UseQueryResult<unknown, unknown>);
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => ({ id: 1, name: 'My Hub' }),
      currentHubId: () => 1,
    } as unknown as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(SourcesService.createSource).mockResolvedValue({ id: 1 } as unknown as Source);
    vi.mocked(googleDriveConnect.pickDriveParentFolder).mockResolvedValue({ folder: { id: 'parent1', name: 'Team docs' }, accessToken: 'token-1' });
    vi.mocked(googleDriveConnect.createFolderWithFiles).mockResolvedValue({
      folder: connectedFolder,
      result: { copied: 2, errors: [] },
    });
    vi.mocked(googleDriveConnect.moveFolder).mockResolvedValue(undefined);
  });

  const editingProps = {
    isEditing: true,
    source: {
      id: 1,
      name: 'My Hub - Suwali Files',
      config: {},
      documents_count: 0,
      updated_at: '',
      source_type: 'google_drive_folder',
    } as Source,
    wizardState: { folderUrl: connectedFolder.url },
  };

  it('creates the folder, copies the files and creates the source on save', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Add source'));

    await waitFor(() =>
      expect(googleDriveConnect.createFolderWithFiles).toHaveBeenCalledWith(
        'token-1',
        aboutData.google_drive_share_email,
        'My Hub - Suwali Files',
        pickedFiles,
        expect.any(Function),
        undefined
      )
    );
    await waitFor(() =>
      expect(SourcesService.createSource).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            name: 'My Hub - Suwali Files',
            source_type: 'google_drive_folder',
            config: { folder_url: connectedFolder.url },
          }),
        })
      )
    );
  });

  it('creates the folder inside the chosen parent folder', async () => {
    renderComponent({ wizardState: { pickedFiles, accessToken: 'token-1', parentFolder: { id: 'parent1', name: 'Team docs' } } });

    expect(screen.getByDisplayValue('Team docs')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add source'));

    await waitFor(() =>
      expect(googleDriveConnect.createFolderWithFiles).toHaveBeenCalledWith(
        'token-1',
        aboutData.google_drive_share_email,
        'My Hub - Suwali Files',
        pickedFiles,
        expect.any(Function),
        'parent1'
      )
    );
  });

  it('hands the picked parent folder back to the wizard', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Choose a different location'));

    await waitFor(() =>
      expect(setWizardState).toHaveBeenCalledWith(
        expect.objectContaining({ parentFolder: { id: 'parent1', name: 'Team docs' } })
      )
    );
    expect(googleDriveConnect.createFolderWithFiles).not.toHaveBeenCalled();
  });

  it('does not touch Drive when the user gives up before saving', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Start over'));

    expect(googleDriveConnect.createFolderWithFiles).not.toHaveBeenCalled();
    expect(SourcesService.createSource).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('moves the connected folder into the chosen one when editing', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            <GoogleDriveWizardChooseLocation
              {...defaultProps}
              {...editingProps}
              wizardState={{ folderUrl: connectedFolder.url, accessToken: 'token-1', parentFolder: { id: 'parent1', name: 'Team docs' } }}
            />
          </ToastProvider>
        </IntlProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('Folder connected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save setup'));

    await waitFor(() =>
      expect(googleDriveConnect.moveFolder).toHaveBeenCalledWith('token-1', 'folder123', 'parent1')
    );
    expect(googleDriveConnect.createFolderWithFiles).not.toHaveBeenCalled();
    expect(SourcesService.createSource).not.toHaveBeenCalled();
  });

  it('cannot be saved when editing until a new folder is chosen', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            <GoogleDriveWizardChooseLocation {...defaultProps} {...editingProps} />
          </ToastProvider>
        </IntlProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('Save setup').closest('button')).toBeDisabled();
    expect(googleDriveConnect.moveFolder).not.toHaveBeenCalled();
  });

  it('shows the error when creating the folder fails', async () => {
    vi.mocked(googleDriveConnect.createFolderWithFiles).mockRejectedValue(new Error('Sharing the folder failed'));

    renderComponent();
    fireEvent.click(screen.getByText('Add source'));

    await screen.findByText('Sharing the folder failed');
    expect(SourcesService.createSource).not.toHaveBeenCalled();
  });

  it('hands the created source over to the parent, which opens it', async () => {
    vi.mocked(SourcesService.createSource).mockResolvedValue({ id: 7 } as unknown as Source);
    const onCreate = vi.fn();

    renderComponent({ onCreate });
    fireEvent.click(screen.getByText('Add source'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(7));
  });

  it('hands the moved source over to the parent, which opens it', async () => {
    const onCreate = vi.fn();

    renderComponent({
      ...editingProps,
      onCreate,
      wizardState: { folderUrl: connectedFolder.url, accessToken: 'token-1', parentFolder: { id: 'parent1', name: 'Team docs' } },
    });
    fireEvent.click(screen.getByText('Save setup'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(1));
  });
});
