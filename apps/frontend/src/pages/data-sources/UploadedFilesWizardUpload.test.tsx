import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import { fetchAbout } from '@services/AboutService';
import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import UploadedFilesWizardUpload from './UploadedFilesWizardUpload';

vi.mock('@services/AboutService', () => ({ fetchAbout: vi.fn() }));
vi.mock('@services/SourcesService');
vi.mock('@root/SessionContext');

const files = [new File(['content'], 'report.pdf', { type: 'application/pdf' })];

const defaultProps = {
  source: undefined,
  isEditing: false,
  isSetup: false,
  readOnly: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange: vi.fn(),
  currentStep: 0,
  wizardState: { files },
  setWizardState: vi.fn(),
};

const renderComponent = (props = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntlProvider locale="en" messages={{}}>
        <UploadedFilesWizardUpload {...defaultProps} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  );

describe('UploadedFilesWizardUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(fetchAbout).mockResolvedValue({ allowed_extensions: 'pdf', max_file_size: '10 MB', max_files_per_upload: 5 } as Awaited<ReturnType<typeof fetchAbout>>);
  });

  it('hands the created source over to the parent, which opens it', async () => {
    vi.mocked(SourcesService.createSourceWithFiles).mockResolvedValue({ id: 7 } as Source);
    const onCreate = vi.fn();

    renderComponent({ onCreate });
    fireEvent.click(screen.getByText('Add files'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(7));
    expect(SourcesService.createSourceWithFiles).toHaveBeenCalledWith(1, 'Uploaded files', files);
  });

  it('hands the source that received the files over to the parent, which opens it', async () => {
    vi.mocked(SourcesService.updateSourceWithFiles).mockResolvedValue({ id: 3 } as Source);
    const onCreate = vi.fn();

    const source: Source = { id: 3, name: 'My files', config: {}, documents_count: 1, updated_at: '', source_type: 'uploaded_files' };
    renderComponent({ isEditing: true, source, onCreate });
    fireEvent.click(screen.getByText('Add files'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(3));
    expect(SourcesService.updateSourceWithFiles).toHaveBeenCalledWith(3, files);
  });

  it('shows the error and stays on the wizard when the upload fails', async () => {
    vi.mocked(SourcesService.createSourceWithFiles).mockRejectedValue(new Error('File too large'));
    const onCreate = vi.fn();

    renderComponent({ onCreate });
    fireEvent.click(screen.getByText('Add files'));

    await screen.findByText('File too large');
    expect(onCreate).not.toHaveBeenCalled();
  });
});
