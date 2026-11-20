import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as googleDriveConnect from '@helpers/googleDriveConnect';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import GoogleDriveWizardSelectFiles from './GoogleDriveWizardSelectFiles';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));
vi.mock('@helpers/googleDriveConnect', async () => ({
  ...(await vi.importActual('@helpers/googleDriveConnect')),
  pickDriveFiles: vi.fn(),
}));
vi.mock('@root/SessionContext');
vi.mock('@services/SourcesService');
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const setWizardState = vi.fn();
const onCancel = vi.fn();
const onStepChange = vi.fn();

const defaultProps = {
  isEditing: false,
  isSetup: false,
  onCancel,
  onCreate: vi.fn(),
  onStepChange,
  currentStep: 0,
  wizardState: {},
  setWizardState,
};

const aboutData = {
  google_drive_share_email: 'services@example.iam.gserviceaccount.com',
  google_oauth_client_id: 'client-1' as string | null,
  google_picker_api_key: 'key-1' as string | null,
  google_picker_app_id: '12345' as string | null,
  max_file_size: '10 MB',
  max_files_per_upload: 20,
  allowed_extensions: 'PDF',
};

const pickedFiles = [
  { id: 'file1', name: 'report.pdf' },
  { id: 'file2', name: 'faq.docx' },
];

const mockAbout = (data = aboutData) => {
  vi.mocked(useQuery).mockReturnValue({
    data,
    isPending: false,
  } as UseQueryResult<unknown, unknown>);
};

const wrap = (props = {}) => (
  <QueryClientProvider client={new QueryClient()}>
    <IntlProvider locale="en" messages={{}}>
      <ToastProvider>
        <GoogleDriveWizardSelectFiles {...defaultProps} {...props} />
      </ToastProvider>
    </IntlProvider>
  </QueryClientProvider>
);

const renderComponent = (props = {}) => render(wrap(props));

describe('GoogleDriveWizardSelectFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => ({ id: 1, name: 'My Hub' }),
      currentHubId: () => 1,
    } as unknown as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(googleDriveConnect.pickDriveFiles).mockResolvedValue({ files: pickedFiles, accessToken: 'token-1' });
  });

  it('hands the selected files to the wizard without touching Drive', async () => {
    mockAbout();

    renderComponent();
    fireEvent.click(screen.getByText('Select files from Google Drive'));

    await waitFor(() =>
      expect(googleDriveConnect.pickDriveFiles).toHaveBeenCalledWith('client-1', { api_key: 'key-1', app_id: '12345' }, 20)
    );
    await waitFor(() =>
      expect(setWizardState).toHaveBeenCalledWith(expect.objectContaining({ pickedFiles, accessToken: 'token-1' }))
    );
  });

  it('moves on to the location step once files are selected', () => {
    mockAbout();

    renderComponent({ wizardState: { pickedFiles, accessToken: 'token-1' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('keeps the continue button disabled until files are selected', () => {
    mockAbout();

    renderComponent();

    expect(screen.getByText('Continue').closest('button')).toBeDisabled();
  });



  it('does not flash the unavailable message while the configuration is loading', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isPending: true,
    } as UseQueryResult<unknown, unknown>);

    renderComponent();

    expect(screen.queryByText('Google Drive is not available')).not.toBeInTheDocument();
    expect(screen.getByText('Select files from Google Drive')).toBeInTheDocument();
  });

  it('says so when the integration is not configured', () => {
    mockAbout({ ...aboutData, google_picker_api_key: null });

    renderComponent();

    expect(screen.queryByText('Select files from Google Drive')).not.toBeInTheDocument();
    expect(screen.getByText('Google Drive is not available')).toBeInTheDocument();
  });
});
