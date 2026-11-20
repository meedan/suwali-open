import type { MessagingPlatform } from './platform';

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export type MessagingIntegration = {
  id: number;
  active: boolean;
  bot_name: string;
  bot_username: string;
  whatsapp_signup: {
    app_id: string,
    configuration_id: string,
    redirect_url: string,
    state: string,
    api_base: string,
    api_version: string,
  };
  signal_link?: {
    uri: string | null;
    status: 'pending' | 'linked' | 'failed' | null;
  };
  platform: MessagingPlatform;
  phone_number: string;
  country?: string;
  registration_type?: string | null;
  registration_status?: string | null;
  rcs_enabled?: boolean;
  opt_in_url?: string | null;
  phone_number_status?: {
    quality_rating: string;
    status: string;
    account_mode: string;
    name_status: string;
  };
  business_verification_status?: string;
  template_statuses?: {
    name: string;
    language: string;
    tone: string;
    status: string | null;
    category: TemplateCategory | null;
  }[];
  created_at: string;
  updated_at: string;
};
