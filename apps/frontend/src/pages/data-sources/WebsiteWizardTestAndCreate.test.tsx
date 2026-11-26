import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import WebsiteWizardTestAndCreate from './WebsiteWizardTestAndCreate';

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
    websiteUrl: 'https://example.com',
    multiPage: false,
    linksCssSelector: 'a.post',
    titleCssSelector: 'h1',
    bodyCssSelector: 'div.body',
  },
  setWizardState: vi.fn(),
};

const previewDoc = { external_id: '1', title: 'Post', content: 'Content', link: 'https://example.com/post', metadata: {} };

const renderComponent = (props = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <WebsiteWizardTestAndCreate {...defaultProps} {...props} />
    </IntlProvider>
  );

describe('WebsiteWizardTestAndCreate', () => {
  beforeEach(() => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(SourcesService.createSource).mockResolvedValue({ id: 1 } as unknown as Source);
  });

  it('uses the suggested name from preview as the source name on create', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
    });

    renderComponent();
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Add source'));
    await waitFor(() =>
      expect(SourcesService.createSource).toHaveBeenCalledWith(
        expect.objectContaining({ source: expect.objectContaining({ name: 'Example Blog' }) })
      )
    );
  });

  it('falls back to the URL as the source name when no suggested name is returned', async () => {
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
        expect.objectContaining({ source: expect.objectContaining({ name: 'https://example.com' }) })
      )
    );
  });

  it('does not overwrite the existing name when editing', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({
      documents: [previewDoc],
      total: 1,
      suggested_name: 'Example Blog',
    });
    vi.mocked(SourcesService.updateSource).mockResolvedValue({ id: 1 } as unknown as Source);

    const source: Source = { id: 1, name: 'My Custom Name', config: {}, documents_count: 0, updated_at: '', source_type: 'website' };
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

  it('hands the created source over to the parent, which opens it', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({ documents: [previewDoc], total: 1, suggested_name: null });
    vi.mocked(SourcesService.createSource).mockResolvedValue({ id: 7 } as unknown as Source);
    const onCreate = vi.fn();

    renderComponent({ onCreate });
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Add source'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(7));
  });

  it('hands the updated source over to the parent, which opens it', async () => {
    vi.mocked(SourcesService.previewSource).mockResolvedValue({ documents: [previewDoc], total: 1, suggested_name: null });
    vi.mocked(SourcesService.updateSource).mockResolvedValue({ id: 3 } as unknown as Source);
    const onCreate = vi.fn();

    const source: Source = { id: 3, name: 'My Custom Name', config: {}, documents_count: 0, updated_at: '', source_type: 'website' };
    renderComponent({ isEditing: true, source, onCreate });
    fireEvent.click(screen.getByText('Test configuration'));
    await waitFor(() => screen.getByText('Test successful'));

    fireEvent.click(screen.getByText('Save setup'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(3));
  });
});
