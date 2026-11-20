import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as SourcesService from '@services/SourcesService';

import { HttpError } from '@root/NetworkLayer';
import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import RSSFeedWizardProvideUrl from './RSSFeedWizardProvideUrl';

vi.mock('@services/SourcesService');
vi.mock('@root/SessionContext');

const onCancel = vi.fn();
const onCreate = vi.fn();
const onStepChange = vi.fn();
const setWizardState = vi.fn();

const defaultProps = {
  isEditing: false,
  isSetup: false,
  onCancel,
  onCreate,
  onStepChange,
  currentStep: 0,
  wizardState: {
    feedUrl: 'https://example.com/feed.xml',
  },
  setWizardState,
};

const renderComponent = (props = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ToastProvider>
            <RSSFeedWizardProvideUrl {...defaultProps} {...props} />
          </ToastProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('RSSFeedWizardProvideUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
      currentHub: () => ({ id: 1, user_agent: 'Suwali/1.0 (Hub 1; +https://suwali.io)' }),
    } as ReturnType<typeof SessionContext.useSession>);
  });

  it('shows the current hub’s User-Agent in the allowlist hint', () => {
    renderComponent();

    expect(screen.getAllByText('Suwali/1.0 (Hub 1; +https://suwali.io)')[0]).toBeInTheDocument();
  });

  it('disables the Continue button while the configure request is in flight', async () => {
    vi.mocked(SourcesService.configureSource).mockReturnValue(new Promise(() => {}));

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    );
  });

  it('shows an error and does not advance when the configure request fails with a network error', async () => {
    vi.mocked(SourcesService.configureSource).mockRejectedValue(new Error('Network error'));

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Unable to reach this feed URL. Please check the URL and try again.')
      ).toBeInTheDocument()
    );
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('shows a rate limit error and does not advance when the configure request returns 429', async () => {
    vi.mocked(SourcesService.configureSource).mockRejectedValue(
      new HttpError(429, { error: 'Rate limit exceeded', error_code: 'rate_limit_exceeded' }, new Headers())
    );

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Too many requests. Please wait a few minutes and try your URL again.')
      ).toBeInTheDocument()
    );
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('shows a content-too-large error and does not advance when the configure request returns 413', async () => {
    vi.mocked(SourcesService.configureSource).mockRejectedValue(
      new HttpError(413, { error: 'Response too large', error_code: 'content_too_large' }, new Headers())
    );

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(
        screen.getByText("This URL returns a file that’s too large to process. Please check the URL and try again.")
      ).toBeInTheDocument()
    );
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('shows an error and does not advance when the configure response contains errors', async () => {
    vi.mocked(SourcesService.configureSource).mockResolvedValue({ error: 'Feed not found' });

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Unable to reach this feed URL. Please check the URL and try again.')
      ).toBeInTheDocument()
    );
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('advances to the next step when the configure request succeeds', async () => {
    vi.mocked(SourcesService.configureSource).mockResolvedValue({
      configuration: { type: 'css', selectors: { body: '.article-body' } },
    });

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(onStepChange).toHaveBeenCalledWith(1)
    );
  });

  describe('wizard state prefill on configure success', () => {
    it('prefills description_only when the feed already contains full content', async () => {
      vi.mocked(SourcesService.configureSource).mockResolvedValue({
        configuration: { type: 'feed', selectors: {} },
      });

      renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(setWizardState).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: 'description_only' })
        )
      );
      expect(setWizardState).not.toHaveBeenCalledWith(
        expect.objectContaining({ cssSelector: expect.anything() })
      );
    });

    it('clears a stale css selector when switching to a feed that does not require scraping', async () => {
      vi.mocked(SourcesService.configureSource).mockResolvedValue({
        configuration: { type: 'feed', selectors: {} },
      });

      renderComponent({
        wizardState: {
          feedUrl: 'https://new-feed.com/feed.xml',
          contentType: 'full_article',
          cssSelector: '.stale-selector',
        },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(setWizardState).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: 'description_only', cssSelector: undefined })
        )
      );
    });

    it('prefills full_article and the detected CSS selector when scraping is needed', async () => {
      vi.mocked(SourcesService.configureSource).mockResolvedValue({
        configuration: { type: 'css', selectors: { body: '.article-body' } },
      });

      renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(setWizardState).toHaveBeenCalledWith(
          expect.objectContaining({ contentType: 'full_article', cssSelector: '.article-body' })
        )
      );
    });

    it('does not prefill wizard state when the selector type cannot be determined', async () => {
      vi.mocked(SourcesService.configureSource).mockResolvedValue({
        configuration: { type: null, selectors: {} },
      });

      renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => expect(onStepChange).toHaveBeenCalledWith(1));
      expect(setWizardState).not.toHaveBeenCalled();
    });
  });
});
