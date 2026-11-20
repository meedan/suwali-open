import type { Scenario } from "@customTypes/external-resource";
import type { ExternalUser } from "@customTypes/external-user";
import type { BotAttributes, Hub, JoinableHub } from "@customTypes/hub";
import type { MessageCluster } from "@customTypes/message-cluster";
import type { MessagingIntegration } from '@customTypes/messaging-integration';
import type { PaginationMetadata } from "@customTypes/pagination-metadata";
import type { ContributionsByContributor, QuestionsByAnswered } from "@customTypes/statistics";
import type { User } from "@customTypes/user";

import { API_BASE_URL, getAuthToken, HttpError, NetworkLayer } from "@root/NetworkLayer";

export const fetchHub = async (hubId: number | string): Promise<Hub> => {
  const response = await NetworkLayer.get<Hub>(`/hubs/${hubId}`);
  return response.data;
};

type HubMembership = {
  id: number;
  hub_id: number;
  user_id: number;
  role: string;
  approved: boolean;
  user: User;
};

export const fetchHubEditors = async (hubId: number | string): Promise<HubMembership[]> => {
  const response = await NetworkLayer.get<HubMembership[]>(`/hubs/${hubId}/memberships`);
  return response.data;
};

export const fetchIntegrations = async (hubId: number | string): Promise<MessagingIntegration[]> => {
  const response = await NetworkLayer.get<MessagingIntegration[]>(`/hubs/${hubId}/messaging-integrations`);
  return response.data;
};

type FetchStatisticsParams = {
  hubId: number | string;
  fields?: string[];
  from?: string;
  to?: string;
  group_by?: 'day' | 'week' | 'month' | 'range' | 'rolling_week';
  limit?: number;
};

export type TopTopic = {
  id: number;
  name: string;
  messages: Record<string, number>;
  data_source_items: Record<string, number>;
};

export type SubscribedTopic = {
  id: number;
  name: string;
  subscribers: number;
  documents: Record<string, number>;
};

type StatisticsResponse = {
  contributions_by_contributor?: ContributionsByContributor[];
  number_of_continued_conversations?: Record<string, number>;
  number_of_new_conversations?: Record<string, number>;
  questions_by_answered?: QuestionsByAnswered[];
  subscribed_topics?: SubscribedTopic[];
  top_topics?: TopTopic[];
  total_conversations?: number;
  unique_end_users?: number;
  average_timeout_window_interval?: number;
  average_timeout_window_message_count?: number;
  range: string[];
};

export const fetchStatistics = async ({
  hubId,
  fields,
  from,
  to,
  group_by,
  limit,
}: FetchStatisticsParams): Promise<StatisticsResponse> => {
  const params = new URLSearchParams();
  if (fields && fields.length > 0) {
    params.append('fields', fields.join(','));
  }
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (group_by) params.append('group_by', group_by);
  if (limit) params.append('limit', String(limit));

  const queryString = params.toString();
  const url = `/hubs/${hubId}/statistics${queryString ? `?${queryString}` : ''}`;
  const response = await NetworkLayer.get<StatisticsResponse>(url);
  return response.data;
};

export const fetchHubTrustedEndUsers = async (hubId: number | string): Promise<ExternalUser[]> => {
  const response = await NetworkLayer.get<ExternalUser[]>(`/hubs/${hubId}/external-users?trusted=true`);
  return response.data;
};

type FetchQuestionsRankingParams = {
  hubId: number | string;
  answered: boolean;
  page: number;
  perPage: number;
  // Without a window the ranking covers the hub's whole history
  from?: string;
  to?: string;
};

export const fetchQuestionsRanking = async ({
  hubId,
  answered,
  page,
  perPage,
  from,
  to,
}: FetchQuestionsRankingParams): Promise<{ data: MessageCluster[], pagination: PaginationMetadata }> => {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
    answered: String(answered),
  });
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const response = await NetworkLayer.get<{ data: MessageCluster[], pagination: PaginationMetadata }>(`/hubs/${hubId}/questions-ranking?${params}`);
  return response.data;
};

type CreateHubParams = {
  name: string;
  file?: File | null;
};

export const createHub = async ({
  name,
  file,
}: CreateHubParams): Promise<Hub> => {
  const formData = new FormData();
  formData.append("hub[name]", name);

  if (file) {
    formData.append("hub[profile_picture]", file);
  }

  const response = await fetch(`${API_BASE_URL}/hubs`, {
    method: "POST",
    body: formData,
    headers: {
      Authorization: getAuthToken(),
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to create hub");
  }

  return await response.json();
};

type UpdateProfileParams = {
  hubId: number | string;
  name?: string;
  file?: File | null;
};

export const updateProfile = async ({
  hubId,
  name,
  file,
}: UpdateProfileParams): Promise<Hub | null> => {
  const formData = new FormData();

  if (name) {
    formData.append("hub[name]", name);
  }

  if (file) {
    formData.append("hub[profile_picture]", file);
  }

  const response = await fetch(`${API_BASE_URL}/hubs/${hubId}`, {
    method: 'PATCH',
    body: formData,
    headers: {
      'Authorization': getAuthToken(),
      "Accept": "*/*",
      // DO NOT set Content-Type manually — fetch will set the correct multipart boundary for you
    }
  });

  let data: Hub | null = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new HttpError(response.status, data, response.headers);
  }

  return data;
};

export const updateInviteCode = async (hubId: number | string) => {
  const response = await NetworkLayer.patch<Hub>(`/hubs/${hubId}/refresh-invite-code`, {});
  return response.data;
};

type RemoveEditorResponse = {
  message: string;
};

export const removeEditor = async (hubId: number | string, membershipId: number | string): Promise<RemoveEditorResponse> => {
  const response = await NetworkLayer.delete<RemoveEditorResponse>(`/hubs/${hubId}/memberships/${membershipId}`);
  return response.data;
};

export const updateMembershipRole = async (
  hubId: number | string,
  membershipId: number | string,
  role: 'admin' | 'editor',
): Promise<HubMembership> => {
  const response = await NetworkLayer.patch<HubMembership>(`/hubs/${hubId}/memberships/${membershipId}`, {
    hub_membership: {
      role
    }
  });
  return response.data;
};

export const approveMembership = async (
  hubId: number | string,
  membershipId: number | string,
): Promise<HubMembership> => {
  const response = await NetworkLayer.patch<HubMembership>(`/hubs/${hubId}/memberships/${membershipId}`, {
    hub_membership: {
      approved: true
    }
  });
  return response.data;
};

export const updateContributionWorkflowMode = async (
  hubId: number | string,
  contributionWorkflowMode: 'direct' | 'review',
): Promise<Hub> => {
  const response = await NetworkLayer.patch<Hub>(`/hubs/${hubId}`, {
    hub: {
      contribution_workflow_mode: contributionWorkflowMode,
    },
  });
  return response.data;
};

export const updateContributionAudience = async (
  hubId: number | string,
  contributionAudience: Hub['contribution_audience'],
): Promise<Hub> => {
  const response = await NetworkLayer.patch<Hub>(`/hubs/${hubId}`, {
    hub: {
      contribution_audience: contributionAudience,
    },
  });
  return response.data;
};

export const updateContributionCode = async (
  hubId: number | string,
  contributionCode: string,
): Promise<Hub> => {
  const response = await NetworkLayer.patch<Hub>(`/hubs/${hubId}`, {
    hub: {
      contribution_code: contributionCode,
    },
  });
  return response.data;
};

export const updateBotAttributes = async (
  hubId: number | string,
  botAttributes: BotAttributes,
): Promise<Hub> => {
  const response = await NetworkLayer.patch<Hub>(`/hubs/${hubId}`, {
    hub: {
      bot_attributes: botAttributes
    }
  });
  return response.data;
};

type PreviewParams = {
  hubId: number | string;
  scenario: Scenario | '';
  language?: string;
};

type PreviewResponse = {
  answer: string;
};

export const fetchPreview = async ({ hubId, scenario, language }: PreviewParams): Promise<string> => {
  const response = await NetworkLayer.post<PreviewResponse>(`/hubs/${hubId}/preview`, { scenario, language });
  return response.data.answer;
};

export const fetchJoinableHubs = async (): Promise<JoinableHub[]> => {
  const response = await NetworkLayer.get<JoinableHub[]>('/hubs/joinable');
  return response.data;
};

type HubMembershipResult = {
  id: number;
  hub_id: number;
  user_id: number;
  role: string;
  approved: boolean;
};

export const createHubMembership = async (hubId: number | string): Promise<HubMembershipResult> => {
  const response = await NetworkLayer.post<HubMembershipResult>(`/hubs/${hubId}/memberships`, {});
  return response.data;
};

type LeaveHubResponse = {
  message: string;
  user: User;
};

export const leaveHub = async (hubId: number | string): Promise<User> => {
  const response = await NetworkLayer.delete<LeaveHubResponse>(`/hubs/${hubId}/memberships/leave`);
  return response.data.user;
};
