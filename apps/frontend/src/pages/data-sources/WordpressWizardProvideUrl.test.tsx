import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import WordpressWizardProvideUrl from './WordpressWizardProvideUrl';

vi.mock('@root/SessionContext');

const onStepChange = vi.fn();
const setWizardState = vi.fn();

const defaultProps = {
  isEditing: false,
  isSetup: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange,
  currentStep: 0,
  wizardState: {
    siteUrl: 'https://blog.example.com',
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
            <WordpressWizardProvideUrl {...defaultProps} {...props} />
          </ToastProvider>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('WordpressWizardProvideUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => ({ id: 1, user_agent: 'Suwali/1.0 (Hub 1; +https://suwali.io)' }),
    } as unknown as ReturnType<typeof SessionContext.useSession>);
  });

  it('shows the current hub’s User-Agent in the allowlist hint', () => {
    renderComponent();

    expect(screen.getByText('Suwali/1.0 (Hub 1; +https://suwali.io)')).toBeInTheDocument();
  });

  it('moves to the next step when a site URL is provided', () => {
    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('disables the Continue button when no site URL is provided', () => {
    renderComponent({ wizardState: { siteUrl: '' } });

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('adds the scheme to the site URL on blur', () => {
    renderComponent({ wizardState: { siteUrl: 'blog.example.com' } });
    fireEvent.blur(screen.getByLabelText(/address of your wordpress site/i), { target: { value: 'blog.example.com' } });

    expect(setWizardState).toHaveBeenCalledWith({ siteUrl: 'https://blog.example.com' });
  });

  it('shows an error and disables Continue for an invalid URL', () => {
    renderComponent({ wizardState: { siteUrl: 'not a url' } });
    fireEvent.blur(screen.getByLabelText(/address of your wordpress site/i), { target: { value: 'not a url' } });

    expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});
