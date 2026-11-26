import type { QuestionsByAnswered } from '@customTypes/statistics';

import { API_BASE_URL, getAuthToken, HttpError, NetworkLayer } from '@root/NetworkLayer';

export type HubCustomLimits = {
  sources?: number;
  messages?: number;
  documents?: number;
  sms?: boolean;
};

export type AdminHub = {
  id: number;
  name: string;
  organization_name: string | null;
  plan: string;
  trial_active: boolean;
  trial_expired: boolean;
  trial_ends_at: string | null;
  created_at: string;
  users_count: number;
  unconfirmed_editors_count: number;
  unapproved_editors_count: number;
  invite_code: string | null;
  active_external_users_count: number;
  max_messages: number | null;
  sources_count: number;
  document_errors_count: number;
  max_sources: number | null;
  documents_count: number;
  last_document_added_at: string | null;
  max_documents: number | null;
  last_internal_conversation_at: string | null;
  last_external_conversation_at: string | null;
  trial_emails_enabled: boolean;
  deletion_requested_at: string | null;
  custom_limits: HubCustomLimits | null;
  whatsapp_phone: string | null;
  telegram_username: string | null;
  signal_phone: string | null;
};

export const fetchAdminHubs = async (): Promise<AdminHub[]> => {
  const response = await NetworkLayer.get<AdminHub[]>('/admin/hubs');
  return response.data;
};

export type AdminHubDetail = AdminHub & {
  last_internal_conversation_at: string | null;
  last_external_conversation_at: string | null;
};

export const fetchAdminHubDetail = async (hubId: number): Promise<AdminHubDetail> => {
  const response = await NetworkLayer.get<AdminHubDetail>(`/admin/hubs/${hubId}`);
  return response.data;
};

export type AdminHubMembershipUser = {
  id: number;
  name: string;
  email: string;
  confirmed: boolean;
  profile_picture_url: string;
  is_public_email_domain: boolean;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
};

export type AdminHubMembership = {
  id: number;
  role: string;
  approved: boolean;
  created_at: string;
  updated_at: string;
  user: AdminHubMembershipUser;
};

export const fetchAdminHubMemberships = async (hubId: number): Promise<AdminHubMembership[]> => {
  const response = await NetworkLayer.get<AdminHubMembership[]>(`/admin/hubs/${hubId}/memberships`);
  return response.data;
};

type AdminHubUpdateParams = {
  plan?: string;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_emails_enabled?: boolean;
  custom_limits?: HubCustomLimits | null;
};

export const createAdminHub = async (params: { name: string; plan: string }): Promise<AdminHubDetail> => {
  const response = await NetworkLayer.post<AdminHubDetail>('/admin/hubs', { hub: params });
  return response.data;
};

export const updateAdminHub = async (hubId: number, params: AdminHubUpdateParams): Promise<AdminHubDetail> => {
  const response = await NetworkLayer.patch<AdminHubDetail>(`/admin/hubs/${hubId}`, { hub: params });
  return response.data;
};

export const deleteAdminHub = async (hubId: number): Promise<void> => {
  await NetworkLayer.delete(`/admin/hubs/${hubId}`);
};

export type AttentionUser = {
  id: number;
  email: string;
  hub_name: string | null;
  hub_id: number | null;
  created_at: string;
  requested_at: string | null;
  last_login_at: string | null;
  last_active_at: string | null;
};

export const fetchUnconfirmedUsers = async (): Promise<AttentionUser[]> => {
  const response = await NetworkLayer.get<AttentionUser[]>('/admin/users/unconfirmed');
  return response.data;
};

export const fetchUsersWithNoHub = async (): Promise<AttentionUser[]> => {
  const response = await NetworkLayer.get<AttentionUser[]>('/admin/users/no-hub');
  return response.data;
};

export const fetchUsersPendingApproval = async (): Promise<AttentionUser[]> => {
  const response = await NetworkLayer.get<AttentionUser[]>('/admin/users/pending-approval');
  return response.data;
};

// threshold_days comes from the API so the dashboard copy matches the cutoff the
// server actually applied (User::INACTIVITY_THRESHOLD).
export type InactiveUsers = {
  threshold_days: number;
  users: AttentionUser[];
};

export const fetchInactiveUsers = async (): Promise<InactiveUsers> => {
  const response = await NetworkLayer.get<InactiveUsers>('/admin/users/inactive');
  return response.data;
};

export const deleteUser = async (userId: number): Promise<void> => {
  await NetworkLayer.delete(`/admin/users/${userId}`);
};

export type SuperAdmin = {
  id: number;
  email: string;
  admin_write_access: boolean;
  created_at: string;
};

export const fetchSuperAdmins = async (): Promise<SuperAdmin[]> => {
  const response = await NetworkLayer.get<SuperAdmin[]>('/admin/users/super-admins');
  return response.data;
};

export const upgradeToWriteAdmin = async (userId: number): Promise<void> => {
  await NetworkLayer.patch(`/admin/users/${userId}/upgrade-to-write-admin`, {});
};

export const moveUserToHub = async (userId: number, hubId: number, approved: boolean): Promise<void> => {
  await NetworkLayer.patch(`/admin/users/${userId}/move-to-hub`, { hub_id: hubId, approved });
};

export type SyncStatusGroupBy = 'day' | 'week' | 'month';

export type DocumentSyncStatusBucket = {
  date: string;
  pending: number;
  error: number;
  complete: number;
};

export type MessageState =
  | 'user_message'
  | 'bot_processing'
  | 'bot_intermediary_message'
  | 'bot_message'
  | 'user_contribution_started'
  | 'bot_contribution_started'
  | 'user_contribution_cancelled'
  | 'bot_contribution_cancelled'
  | 'user_contribution_submitted'
  | 'bot_contribution_submitted'
  | 'closed_window'
  | 'unsupported_message'
  | 'knowledge_service_error'
  | 'rate_limit_reached';

export type MessageStateBucket = { date: string } & Record<MessageState, number>;

export type GlobalCounts = {
  hubs: number;
  sources: number;
  conversations: number;
  users: number;
  external_users: number;
  documents: number;
  messages: number;
  hubs_all_time: number;
  hubs_churned: number;
};

export type AverageAnswerTimes = {
  all_time: number | null;
  last_week: number | null;
  last_month: number | null;
};

export type ChurnedHub = {
  hub_id: number;
  hub_name: string;
  organization_name: string | null;
  plan_at_deletion: string;
  created_at: string;
  deleted_at: string;
};

export type HubsByCreationDateBucket = {
  date: string;
  active: number;
  deleted: number;
};

export type PlatformStatistics = {
  global_counts: GlobalCounts;
  churned_hubs: ChurnedHub[];
  documents_by_sync_status: DocumentSyncStatusBucket[];
  messages_by_state: MessageStateBucket[];
  questions_by_answered: QuestionsByAnswered[];
  hubs_by_creation_date: HubsByCreationDateBucket[];
  average_answer_times: AverageAnswerTimes;
};

export const fetchPlatformStatistics = async (params?: { group_by?: SyncStatusGroupBy; from?: string; to?: string }): Promise<PlatformStatistics> => {
  const query = new URLSearchParams();
  if (params?.group_by) query.set('group_by', params.group_by);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const qs = query.toString();
  const response = await NetworkLayer.get<PlatformStatistics>(`/admin/statistics${qs ? `?${qs}` : ''}`);
  return response.data;
};

export type AdminMessageReport = {
  id: number;
  hub_id: number | null;
  hub_name: string | null;
  message_id: number;
  message_link: string | null;
  platform: string | null;
  user_question: string | null;
  message_body: string | null;
  message_sent_at: string | null;
  reported_by_email: string | null;
  comment: string | null;
  created_at: string;
};

export type AdminMessageReportsPage = {
  data: AdminMessageReport[];
  pagination: { current_page: number; per_page: number; total_pages: number; total_count: number };
};

export const fetchAdminMessageReports = async (params: { hubId?: number; page: number }): Promise<AdminMessageReportsPage> => {
  const query = new URLSearchParams({ page: String(params.page) });
  if (params.hubId) query.set('hub_id', String(params.hubId));
  const response = await NetworkLayer.get<AdminMessageReportsPage>(`/admin/message-reports?${query}`);
  return response.data;
};

export type AdminHubActivityEventType =
  | 'hub_created'
  | 'hub_deleted'
  | 'plan_changed'
  | 'deletion_requested'
  | 'membership_added'
  | 'membership_removed'
  | 'source_added'
  | 'source_removed'
  | 'document_first_synced'
  | 'messaging_connected'
  | 'messaging_disconnected'
  | 'trial_dates_changed'
  | 'custom_limits_changed'
  | 'feature_flag_changed'
  | 'trial_emails_toggled';

export type AdminHubActivityEvent = {
  type: AdminHubActivityEventType;
  at: string;
  actor_email: string | null;
  detail: string | null;
  // Only present on plan_changed events, as plain plan labels (e.g. "free", "standard") — detail
  // is the human-readable "old → new" string, these are for deriving semantics like "went from a
  // free plan to a paid one" without parsing that string.
  old_plan?: string;
  new_plan?: string;
};

export const fetchAdminHubActivity = async (hubId: number): Promise<AdminHubActivityEvent[]> => {
  const response = await NetworkLayer.get<AdminHubActivityEvent[]>(`/admin/hubs/${hubId}/activity`);
  return response.data;
};

export type DeletedHubDetail = ChurnedHub & {
  activity: AdminHubActivityEvent[];
};

export const fetchAdminDeletedHubDetail = async (hubId: number): Promise<DeletedHubDetail> => {
  const response = await NetworkLayer.get<DeletedHubDetail>(`/admin/hubs/${hubId}/deleted`);
  return response.data;
};

// A raw fetch, not NetworkLayer, because the response is a file and NetworkLayer parses every body as JSON.
export const downloadExport = async (path: string): Promise<Blob> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Authorization': getAuthToken() },
  });

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      // non-JSON error body: callers fall back to a generic message
    }
    throw new HttpError(response.status, data, response.headers);
  }

  return response.blob();
};
