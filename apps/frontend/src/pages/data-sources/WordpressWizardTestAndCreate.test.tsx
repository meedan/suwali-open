import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import WordpressWizardTestAndCreate from './WordpressWizardTestAndCreate';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@services/SourcesService');
vi.mock('@root/SessionContext');

const defaultProps = {
  source: undefined,
  isEditing: false,
  isSetup: false,
  readOnly: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange: vi.fn(),
  currentStep: 1,
  wizardState: {
    siteUrl: 'https://blog.example.com',
  },
  setWizardState: vi.fn(),
};

const previewDoc = { external_id: '1', title: 'Hello world', content: 'Post body', link: 'https://blog.example.com/hello-world/', metadata: {} };

const renderComponent = (props = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <WordpressWizardTestAndCreate {...defaultProps} {...props} />
    </IntlProvider>
  );

describe('WordpressWizardTestAndCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(SourcesService.createSource).mockResolvedValue({ id: 1 } as unknown as Source);
  });

  it('previews the site as a WordPress source', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
    });

    renderComponent();
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    expect(SourcesService.previewSource).toHaveBeenCalledWith({
      source: expect.objectContaining({
        source_type: 'wordpress_api',
        config: { site_url: 'https://blog.example.com', content_type: 'posts' },
      }),
    });
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('creates the source with the suggested name and normalized site URL', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
      suggested_url: 'https://blog.example.com',
    });

    renderComponent({ wizardState: { siteUrl: 'https://blog.example.com/wp-json/' } });
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Add source'));
    await waitFor(() =>
      expect(SourcesService.createSource).toHaveBeenCalledWith({
        source: expect.objectContaining({
          name: 'Example Blog',
          source_type: 'wordpress_api',
          config: { site_url: 'https://blog.example.com', content_type: 'posts' },
        }),
      })
    );
  });

  it('sends the ownership receipt with the new source', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
    });

    renderComponent({ wizardState: { siteUrl: 'https://blog.example.com', ownershipReceipt: 'signed-receipt' } });
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Add source'));
    await waitFor(() =>
      expect(SourcesService.createSource).toHaveBeenCalledWith({
        source: expect.objectContaining({ ownership_receipt: 'signed-receipt' }),
      })
    );
  });

  it('falls back to the site URL as the source name when no suggested name is returned', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: null,
    });

    renderComponent();
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Add source'));
    await waitFor(() =>
      expect(SourcesService.createSource).toHaveBeenCalledWith(
        expect.objectContaining({ source: expect.objectContaining({ name: 'https://blog.example.com' }) })
      )
    );
  });

  it('shows the error returned by the preview', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(SourcesService.previewSource).mockRejectedValue(new Error('WordPress API request failed with status 404'));

    renderComponent();
    fireEvent.click(screen.getByText('Test configuration'));

    await waitFor(() => screen.getByText('WordPress API request failed with status 404'));
    expect(screen.getByText('Add source').closest('button')).toBeDisabled();
    expect(consoleError).toHaveBeenCalledWith('Error previewing Data Source:', expect.any(Error));
  });

  it('does not overwrite the existing name when editing', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
    });
    vi.mocked(SourcesService.updateSource).mockResolvedValue({ id: 1 } as unknown as Source);

    const source: Source = { id: 1, name: 'My Custom Name', config: { site_url: 'https://blog.example.com' }, documents_count: 0, updated_at: '', source_type: 'wordpress_api' };
    renderComponent({ isEditing: true, source });

    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Save setup'));
    await waitFor(() =>
      expect(SourcesService.updateSource).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ source: expect.objectContaining({ name: 'My Custom Name' }) })
      )
    );
  });
});
