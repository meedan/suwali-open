import type { Hub } from '@customTypes/hub';

// A hub on an active free trial; pass only the fields a test cares about
export const buildHub = (overrides: Partial<Hub> = {}): Hub => {
  const id = overrides.id ?? 1;
  return {
    id,
    name: 'Test Hub',
    plan: 'free',
    invite_code: 'abc123',
    contribution_code: 'contrib123',
    contribution_workflow_mode: 'direct',
    contribution_audience: 'trusted_end_users',
    profile_picture_url: '',
    allowed_features: {},
    trial_active: true,
    trial_expired: false,
    restricted: true,
    active_external_users_count: 0,
    external_data_sources_count: 0,
    documents_count: 0,
    monthly_messages_count: 0,
    max_sources_for_plan: 1,
    max_documents_for_plan: 100,
    max_messages_for_plan: 1000,
    user_agent: `Suwali/1.0 (Hub ${id}; +https://suwali.io)`,
    ...overrides,
  };
};
