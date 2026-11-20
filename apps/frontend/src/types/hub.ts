export type Tone = 'journalist' | 'advocate' | 'executive';

export type BotAttributes = {
  name?: string;
  description?: string;
  tone?: Tone;
  default_language?: string;
  supported_languages?: string[];
};

export type CanDecision = {
  allowed: boolean;
  reasons?: string[];
};

export type Capabilities = {
  CREATE_SOURCE: CanDecision;
  CREATE_DOCUMENT: CanDecision;
  MANAGE_MESSAGING_INTEGRATION: CanDecision;
  MANAGE_SMS: CanDecision;
  MANAGE_EXTERNAL_USERS: CanDecision;
  MANAGE_EXTERNAL_RESOURCE: CanDecision;
  CREATE_CONTRIBUTION: CanDecision;
  CREATE_MESSAGE: CanDecision;
  CREATE_NOTE: CanDecision;
  CREATE_NOTEBOOK_ITEM: CanDecision;
  CREATE_NOTEBOOK: CanDecision;
  CREATE_CONVERSATION: CanDecision;
  APPROVE_MEMBERSHIP: CanDecision;
  MANAGE_ADMINS: CanDecision;
  REMOVE_EDITOR: CanDecision;
  UPDATE_SOURCE: CanDecision;
  REMOVE_SOURCE: CanDecision;
  UPDATE_HUB: CanDecision;
  CREATE_TOPIC: CanDecision;
  IS_ADMIN: CanDecision;
  IS_WRITE_ADMIN: CanDecision;
};

export type JoinableHub = {
  id: number;
  name: string;
  created_at: string;
  users_count: number;
  admin_email: string;
};

export type Hub = {
  id: number;
  name: string;
  profile_picture_url: string;
  allowed_features: Record<string, boolean>;
  bot_attributes?: BotAttributes;
  contribution_code: string;
  invite_code: string | null;
  contribution_workflow_mode: 'direct' | 'review';
  contribution_audience: 'trusted_end_users' | 'all_end_users';
  plan: 'free' | 'enterprise' | 'free_unrestricted' | 'subsidized' | 'standard' | 'pro';
  trial_active: boolean;
  trial_expired: boolean;
  restricted: boolean;
  active_external_users_count: number;
  external_data_sources_count: number;
  documents_count: number;
  monthly_messages_count: number;
  max_sources_for_plan: number | null;
  max_documents_for_plan: number | null;
  max_messages_for_plan: number | null;
  user_agent: string;
  trial_started_at?: string;
  trial_ends_at?: string;
  onboarding_tasks?: {
    document_synced: boolean;
    source_created: boolean;
    internal_conversation_message_received: boolean;
    messaging_platform_connected: boolean;
    // Same as the two tasks above, but ignoring the preloaded source and its document
    own_source_created: boolean;
    own_document_synced: boolean;
  };
  pending_approvals?: number;
  hub_membership?: {
    id: number | null; // id can be null for super-admin virtual membership
    hub_id: number;
    user_id: number;
    approved: boolean;
    capabilities?: Capabilities;
    onboarding_tasks: {
      profile_filled: boolean;
      internal_conversation_started: boolean;
      multiple_notebooks_created: boolean;
      notebook_published: boolean;
    };
    role: 'admin' | 'editor';
  };
};
