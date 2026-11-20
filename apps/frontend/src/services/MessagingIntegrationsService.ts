import type { MessagingIntegration } from '@customTypes/messaging-integration';
import type { MessagingPlatform } from '@customTypes/platform';

import { NetworkLayer } from '@root/NetworkLayer';

export const connectMessagingIntegration = async (
  hubId: number,
  platform: MessagingPlatform,
  params: Record<string, string> = {},
): Promise<MessagingIntegration> => {
  const response = await NetworkLayer.post<MessagingIntegration>('/messaging-integrations', {
    messaging_integration: { hub_id: hubId, platform, ...params },
  });
  return response.data;
};

export const disconnectMessagingIntegration = async (integrationId: number): Promise<void> => {
  await NetworkLayer.delete(`/messaging-integrations/${integrationId}`);
};

export type WhatsappSignupCallback = {
  integration_id: number;
  code: string;
  state: string;
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
};

export const completeWhatsappSignup = async (payload: WhatsappSignupCallback): Promise<void> => {
  await NetworkLayer.post('/messaging-integrations/whatsapp-callback', payload);
};
