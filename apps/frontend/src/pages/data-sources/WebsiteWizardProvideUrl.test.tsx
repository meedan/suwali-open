import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as NL from '@root/NetworkLayer';
import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import WebsiteWizardProvideUrl from './WebsiteWizardProvideUrl';

vi.mock('@root/NetworkLayer', () => ({
  NetworkLayer: { post: vi.fn(), get: vi.fn() },
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number) { super(); this.status = status; }
  },
  API_BASE_URL: '',
  getAuthToken: vi.fn(),
}));
vi.mock('@root/SessionContext');

const defaultState = { multiPage: true, websiteUrl: '' };

const defaultProps = {
  isEditing: false,
  isSetup: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange: vi.fn(),
  currentStep: 0,
  wizardState: defaultState,
  setWizardState: vi.fn(),
};

const renderComponent = (props = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ToastProvider>
            <WebsiteWizardProvideUrl {...defaultProps} {...props} />
          </ToastProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

// wizardState with a valid URL — enables the Continue button
const readyState = { multiPage: false, websiteUrl: 'https://example.com' };

describe('WebsiteWizardProvideUrl', () => {
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

  it('should display invalid URL error if invalid URL', () => {
    renderComponent({ wizardState: { ...defaultState, websiteUrl: 'not a valid url' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByText('Invalid URL')).toBeInTheDocument();
  });

  describe('configure', () => {
    it('should make a request to configure with the provided URL', async () => {
      vi.mocked(NL.NetworkLayer.post).mockResolvedValue({
        data: { configuration: { type: null, selectors: {} } },
        headers: new Headers(),
        status: 200,
      });

      renderComponent({ wizardState: readyState });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(NL.NetworkLayer.post).toHaveBeenCalledWith(
          '/sources/configure',
          {
            source: {
              hub_id: 1,
              source_type: 'website',
              config: { base_url: readyState.websiteUrl },
            },
          }
        )
      );
    });

    it('should advance to the next step and pre-fill state on a successful response', async () => {
      vi.mocked(NL.NetworkLayer.post).mockResolvedValue({
        data: { configuration: { type: 'wordpress', selectors: { link: 'article h2 a', title: 'h1.entry-title', body: '.entry-content' } } },
        headers: new Headers(),
        status: 200,
      });

      renderComponent({ wizardState: readyState });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(defaultProps.setWizardState).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'wordpress',
            linksCssSelector: 'article h2 a',
            titleCssSelector: 'h1.entry-title',
            bodyCssSelector: '.entry-content',
          })
        )
      );
      expect(defaultProps.onStepChange).toHaveBeenCalledWith(1);
    });

    it('should advance and partially pre-fill state on a partial response', async () => {
      vi.mocked(NL.NetworkLayer.post).mockResolvedValue({
        data: { configuration: { type: null, selectors: { link: 'article h2 a', title: null, body: null } } },
        headers: new Headers(),
        status: 200,
      });

      renderComponent({ wizardState: readyState });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(defaultProps.setWizardState).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: undefined,
            linksCssSelector: 'article h2 a',
            titleCssSelector: undefined,
            bodyCssSelector: undefined,
          })
        )
      );
      expect(defaultProps.onStepChange).toHaveBeenCalledWith(1);
    });

    it.each([
      // multi_page, suggested_website_url, expected multiPage, expected templateUrl, expected paginationSampleUrl
      [true, 'https://example.com/page/{page}', true, 'https://example.com/page/{page}', 'https://example.com/page/2'],
      [false, null, false, undefined, undefined],
      [null, null, readyState.multiPage, undefined, undefined],
    ] as [boolean | null, string | null, boolean, string | undefined, string | undefined][])(
      'should set multiPage/templateUrl/paginationSampleUrl from the pagination response (multi_page: %s)',
      async (multiPage, suggestedWebsiteUrl, expectedMultiPage, expectedTemplateUrl, expectedPaginationSampleUrl) => {
        vi.mocked(NL.NetworkLayer.post).mockResolvedValue({
          data: {
            configuration: {
              type: null,
              selectors: {},
              pagination: { multi_page: multiPage, suggested_website_url: suggestedWebsiteUrl },
            },
          },
          headers: new Headers(),
          status: 200,
        });

        renderComponent({ wizardState: readyState });
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));

        await waitFor(() =>
          expect(defaultProps.setWizardState).toHaveBeenCalledWith(
            expect.objectContaining({
              multiPage: expectedMultiPage,
              templateUrl: expectedTemplateUrl,
              paginationSampleUrl: expectedPaginationSampleUrl,
            })
          )
        );
      }
    );

    it('should show an error and not advance if configure fails to reach the provided URL', async () => {
      vi.mocked(NL.NetworkLayer.post).mockRejectedValue(new Error('Network error'));

      renderComponent({ wizardState: readyState });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(screen.getByText(/unable to reach this url/i)).toBeInTheDocument()
      );
      expect(defaultProps.onStepChange).not.toHaveBeenCalled();
    });

    it('should disable Continue and show a loader while the request is in flight', async () => {
      vi.mocked(NL.NetworkLayer.post).mockReturnValue(new Promise(() => {}));

      renderComponent({ wizardState: readyState });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
      );
      expect(document.querySelector('[class*="pollingLoading"]')).toBeInTheDocument();
    });
  });
});
