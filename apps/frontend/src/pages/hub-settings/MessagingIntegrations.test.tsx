import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import type { MessagingIntegration, TemplateCategory } from '@customTypes/messaging-integration';

import type { About } from '@services/AboutService';
import * as AboutService from '@services/AboutService';
import * as HubService from '@services/HubService';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import MessagingIntegrations from './MessagingIntegrations';

vi.mock('@services/AboutService');
vi.mock('@services/HubService');
vi.mock('@root/SessionContext', () => ({
  useSession: vi.fn(),
}));
vi.mock('@components/Can', () => ({
  Can: ({ children }: { children: React.ReactNode | ((decision: { allowed: boolean }) => React.ReactNode) }) => (
    <>{typeof children === 'function' ? children({ allowed: true }) : children}</>
  ),
}));
vi.mock('@trial-banners/TrialMessagingBanner', () => ({ default: () => null }));

const MARKETING_EXPLANATION = /re-classified as “marketing”\. You can appeal this decision with Meta\.$/;

const template = (tone: string, language: string, status: string | null, category: TemplateCategory | null) => ({
  name: `suwali_topic_notification_${tone}_v3`,
  language,
  tone,
  status,
  category,
});

const whatsappIntegration = (templateStatuses: NonNullable<MessagingIntegration['template_statuses']>) => ({
  id: 4,
  active: true,
  platform: 'whatsapp',
  phone_number: '+1 555 010 0000',
  phone_number_status: { quality_rating: 'GREEN', status: 'CONNECTED', account_mode: 'LIVE', name_status: 'APPROVED' },
  business_verification_status: 'VERIFIED',
  template_statuses: templateStatuses,
}) as MessagingIntegration;

const mockIntegrations = (templateStatuses: NonNullable<MessagingIntegration['template_statuses']>) => {
  vi.mocked(HubService.fetchIntegrations).mockResolvedValue([whatsappIntegration(templateStatuses)]);
};

const renderComponent = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <ToastProvider>
            <TooltipPrimitive.Provider delayDuration={0}>
              <MessagingIntegrations />
            </TooltipPrimitive.Provider>
          </ToastProvider>
        </IntlProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

const findStatusBadge = (status: string) => screen.findByText(status);

describe('MessagingIntegrations WhatsApp templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHubId: () => 3,
      currentHub: () => undefined,
    } as ReturnType<typeof SessionContext.useSession>);
    vi.mocked(AboutService.fetchAbout).mockResolvedValue({ languages: [{ code: 'es', name: 'Spanish' }, { code: 'fr', name: 'French' }] } as unknown as About);
  });

  it('explains the reclassification and how to appeal when hovering a marketing template', async () => {
    mockIntegrations([template('advocate', 'es', 'APPROVED', 'MARKETING')]);

    renderComponent();

    fireEvent.pointerMove(await findStatusBadge('APPROVED'));

    expect((await screen.findAllByText(MARKETING_EXPLANATION)).length).toBeGreaterThan(0);
  });
});
