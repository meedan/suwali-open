import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as SourcesService from '@services/SourcesService';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import DataSourcesCreateWizard from './DataSourcesCreateWizard';

vi.mock('@services/SourcesService');
vi.mock('@root/SessionContext');

const renderWizard = () => {
  const onTypeChange = vi.fn();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ToastProvider>
            <DataSourcesCreateWizard onCreate={vi.fn()} onTypeChange={onTypeChange} />
          </ToastProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
  return onTypeChange;
};

const startWizard = (type: RegExp) => {
  fireEvent.click(screen.getByRole('radio', { name: type }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
};

describe('DataSourcesCreateWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 1,
      currentHub: () => ({ id: 1, user_agent: 'Suwali/1.0 (Hub 1; +https://suwali.io)' }),
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(SourcesService.detectWordpressSite).mockResolvedValue({ site_url: 'https://blog.example.com' });
    vi.mocked(SourcesService.fetchOwnershipCode).mockResolvedValue({
      code: 'suwali-abc123',
      settings_url: 'https://blog.example.com/wp-admin/options-general.php',
      authorize_url: null,
    });
  });

  it.each([
    [/RSS feed/, 'https://blog.example.com/feed'],
    [/Blog\/Website/, 'https://blog.example.com/news'],
  ])('hands a WordPress URL pasted in the %s wizard over to the WordPress wizard', async (type, url) => {
    const onTypeChange = renderWizard();
    startWizard(type);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: url } });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with WordPress' }));

    expect(onTypeChange).toHaveBeenLastCalledWith('wordpress_api');
    // Lands on verifying ownership of the detected site, without asking for its address again
    await waitFor(() =>
      expect(SourcesService.fetchOwnershipCode).toHaveBeenCalledWith({
        source: { hub_id: 1, source_type: 'wordpress_api', config: { site_url: 'https://blog.example.com' } },
      })
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the detected address when going back to the WordPress URL step', async () => {
    renderWizard();
    startWizard(/RSS feed/);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://blog.example.com/feed' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with WordPress' }));
    fireEvent.click(await screen.findByRole('button', { name: /back/i }));

    expect(screen.getByRole('textbox')).toHaveValue('https://blog.example.com');
  });
});
