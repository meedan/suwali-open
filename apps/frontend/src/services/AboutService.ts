import { NetworkLayer } from '@root/NetworkLayer';

export type PlanData = {
  sources: number | null;
  documents: number | null;
  messages: number | null;
};

export type PlansData = {
  trial: PlanData;
  subsidized: PlanData;
  standard: PlanData;
  pro: PlanData;
  enterprise: PlanData;
};

export type LanguageOption = {
  code: string;
  name: string;
};

export type SmsCountryOption = {
  code: string;
  name: string;
  number_types: string[];
};

export type About = {
  google_drive_share_email: string;
  google_oauth_client_id: string | null;
  google_picker_api_key: string | null;
  google_picker_app_id: string | null;
  max_file_size: string;
  max_files_per_upload: number;
  max_summary_length: number;
  max_topic_name_length: number;
  max_resource_question_length: number;
  max_resource_description_length: number;
  allowed_extensions: string;
  hub_trial_length_days: number;
  conversation_inactivity_timeout_minutes: number;
  schedule_demo_link: string;
  plans: PlansData;
  languages: LanguageOption[];
  sms_countries: SmsCountryOption[];
};

export const fetchAbout = async (): Promise<About> => {
  const response = await NetworkLayer.get<About>('/about');
  return response.data;
};
