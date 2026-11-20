import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Source } from '@customTypes/source';

import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import WordpressWizardVerifyOwnership from './WordpressWizardVerifyOwnership';

vi.mock('@services/SourcesService');
vi.mock('@root/SessionContext');

const onStepChange = vi.fn();
const setWizardState = vi.fn();

const defaultProps = {
  source: undefined,
  isEditing: false,
  isSetup: false,
  readOnly: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange,
  currentStep: 1,
  wizardState: {
    siteUrl: 'https://blog.example.com',
  },
  setWizardState,
};

const renderComponent = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ToastPrimitive.Provider>
            <ToastProvider>
              <WordpressWizardVerifyOwnership {...defaultProps} {...props} />
            </ToastProvider>
          </ToastPrimitive.Provider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('WordpressWizardVerifyOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(SourcesService.fetchOwnershipCode).mockResolvedValue({
      code: 'suwali-7f3a9c2e41d0',
      settings_url: 'https://blog.example.com/wp-admin/options-general.php',
      authorize_url: null,
    });
  });

  it('shows the code and links to the site’s settings', async () => {
    renderComponent();

    expect(await screen.findByText('suwali-7f3a9c2e41d0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'General settings' }))
      .toHaveAttribute('href', 'https://blog.example.com/wp-admin/options-general.php');
    expect(SourcesService.fetchOwnershipCode).toHaveBeenCalledWith({
      source: { hub_id: 1, source_type: 'wordpress_api', config: { site_url: 'https://blog.example.com' } },
    });
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('stores the receipt once the code is found', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockResolvedValue({ verified: true, receipt: 'signed-receipt' });

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(setWizardState).toHaveBeenCalledWith({
      siteUrl: 'https://blog.example.com',
      ownershipReceipt: 'signed-receipt',
      applicationPasswordRevoked: undefined,
    }));
  });

  it('explains what to check when the code is not found', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockResolvedValue({ verified: false });

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('We couldn’t find the code yet')).toBeInTheDocument();
    expect(setWizardState).not.toHaveBeenCalled();
  });

  it('shows the error when the tagline cannot be read', async () => {
    vi.mocked(SourcesService.verifySourceOwnership).mockRejectedValue(new Error('Could not read the tagline'));

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Could not read the tagline')).toBeInTheDocument();
  });

  it('lets the user continue once verified', () => {
    renderComponent({ wizardState: { siteUrl: 'https://blog.example.com', ownershipReceipt: 'signed-receipt' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Ownership verified')).toBeInTheDocument();
    expect(onStepChange).toHaveBeenCalledWith(2);
  });

  it('does not ask again when editing a source whose site has not changed', () => {
    const source = { id: 1, config: { site_url: 'https://blog.example.com' } } as Source;

    renderComponent({ source, isEditing: true });

    expect(screen.getByText('You verified this site when you added it.')).toBeInTheDocument();
    expect(SourcesService.fetchOwnershipCode).not.toHaveBeenCalled();
  });

  it('asks again when editing a source to point at another site', async () => {
    const source = { id: 1, config: { site_url: 'https://old.example.com' } } as Source;

    renderComponent({ source, isEditing: true });

    expect(await screen.findByText('suwali-7f3a9c2e41d0')).toBeInTheDocument();
  });

  describe('when the site supports Application Passwords', () => {
    beforeEach(() => {
      vi.mocked(SourcesService.fetchOwnershipCode).mockResolvedValue({
        code: 'suwali-7f3a9c2e41d0',
        settings_url: 'https://blog.example.com/wp-admin/options-general.php',
        authorize_url: 'https://blog.example.com/wp-admin/authorize-application.php?app_name=Suwali',
      });
    });

    it('offers to approve Suwali, with the tagline as the alternative', async () => {
      renderComponent();

      expect(await screen.findByRole('button', { name: 'Approve on WordPress' })).toBeInTheDocument();
      expect(screen.queryByText('suwali-7f3a9c2e41d0')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Add a code to your site’s tagline instead' }));

      expect(screen.getByText('suwali-7f3a9c2e41d0')).toBeInTheDocument();
    });

    it('lets the user go back to approving Suwali after choosing the tagline', async () => {
      renderComponent();

      fireEvent.click(await screen.findByRole('button', { name: 'Add a code to your site’s tagline instead' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve Suwali on your site instead' }));

      expect(screen.getByRole('button', { name: 'Approve on WordPress' })).toBeInTheDocument();
      expect(screen.queryByText('suwali-7f3a9c2e41d0')).not.toBeInTheDocument();
    });
  });

  it('says the Application Password was removed once verified with it', () => {
    renderComponent({
      wizardState: { siteUrl: 'https://blog.example.com', ownershipReceipt: 'signed-receipt', applicationPasswordRevoked: true },
    });

    expect(screen.getByText('We removed the Application Password we used to check.')).toBeInTheDocument();
  });

  it('asks the user to revoke the Application Password when Suwali could not', () => {
    renderComponent({
      wizardState: { siteUrl: 'https://blog.example.com', ownershipReceipt: 'signed-receipt', applicationPasswordRevoked: false },
    });

    expect(screen.getByText(/You can revoke “Suwali” under Application Passwords/)).toBeInTheDocument();
  });
});
