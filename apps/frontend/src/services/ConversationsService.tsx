import type { BulkConversationExport, Conversation } from "@customTypes/conversation";
import type { Message } from "@customTypes/message";
import type { PermalinkPaginationMetadata } from "@customTypes/permalink-pagination-metadata";

import { NetworkLayer } from "@root/NetworkLayer";

export const fetchConversation = async (conversationId: number): Promise<Conversation> => {
  const response = await NetworkLayer.get<Conversation>(`/conversations/${conversationId}`);
  return response.data;
};

type ConversationsPaginatedResponse = {
  data: Conversation[];
  pagination: PermalinkPaginationMetadata;
};

export const fetchConversations = async (
  hubId: number | string,
  aroundId: number | null = null,
  windowSize: number = 20,
  filter = {},
): Promise<ConversationsPaginatedResponse> => {
  const params = new URLSearchParams({ ...filter });

  if (aroundId) {
    params.append('around_id', aroundId.toString());
  }

  params.append('window_size', windowSize.toString());

  const response = await NetworkLayer.get<ConversationsPaginatedResponse>(`/hubs/${hubId}/conversations?${params.toString()}`);
  return response.data;
};

export const requestBulkConversationExport = async (hubId: number | string): Promise<BulkConversationExport> => {
  const response = await NetworkLayer.post<BulkConversationExport>(`/hubs/${hubId}/conversations/bulk-export`, {});
  return response.data;
};

export const fetchLatestBulkConversationExport = async (hubId: number | string): Promise<BulkConversationExport | null> => {
  const response = await NetworkLayer.get<BulkConversationExport | null>(`/hubs/${hubId}/conversations/bulk-export/latest`);
  return response.data;
};

type MessagesPaginatedResponse = {
  data: Message[];
  pagination: PermalinkPaginationMetadata;
};

// Permalink pagination with aroundId and windowSize
export const fetchMessagesPaginated = async (
  conversationId: number | string,
  aroundId: number | null = null,
  windowSize: number = 20,
  sortBy: string = 'created_at',
  sortDirection: string = 'asc',
  anchor?: 'first' | 'last',
): Promise<MessagesPaginatedResponse> => {
  const params = new URLSearchParams();

  if (aroundId) {
    params.append('around_id', aroundId.toString());
  } else if (anchor) {
    params.append('anchor', anchor);
  }

  params.append('window_size', windowSize.toString());
  params.append('sort_by', sortBy);
  params.append('sort_direction', sortDirection);

  const response = await NetworkLayer.get<MessagesPaginatedResponse>(
    `/conversations/${conversationId}/messages?${params.toString()}`
  );

  return response.data;
};

type SendMessageResponse = {
  body: string;
  conversation_id: number;
  created_at: string;
  direction: "incoming";
  id: number;
  updated_at: string;
};

export const fetchLatestOwnConversation = async (hubId: number | string): Promise<Conversation | null> => {
  const response = await NetworkLayer.get<ConversationsPaginatedResponse>(
    `/hubs/${hubId}/my-conversations?window_size=1&sort_by=created_at&sort_direction=desc`
  );
  return response.data.data[0] ?? null;
};

export const sendMessage = async (conversationId: number, body: string): Promise<SendMessageResponse> => {
  const response = await NetworkLayer.post<SendMessageResponse>('/messages', { message: { conversation_id: conversationId, body }});
  return response.data
};

export const interactionCallback = async (messageId: number, id: string, type: string): Promise<void> => {
  await NetworkLayer.post(`/messages/${messageId}/callback`, { callback: { id, type }});
};

export const createConversation = async (hubId: number | string, title: string): Promise<Conversation> => {
  const response = await NetworkLayer.post<Conversation>('/conversations', { conversation: { hub_id: hubId, title } });
  return response.data;
};

export const mutateEditConversationTitle = async (conversationId: number, newTitle: string): Promise<Conversation> => {
  const response = await NetworkLayer.patch<Conversation>(`/conversations/${conversationId}`, { conversation: { id: conversationId, title: newTitle }});
  return response.data;
};

type DeleteConversationResponse = {
  message: string;
};

export const deleteConversation = async (conversationId: number): Promise<DeleteConversationResponse> => {
  const response = await NetworkLayer.delete<DeleteConversationResponse>(`/conversations/${conversationId}`);
  return response.data;
};

type CreateMessageReportResponse = {
  id: number;
  message_id: number;
  comment: string;
  created_at: string;
};

export const mutateCreateMessageReport = async (
  messageId: number,
  comment: string,
): Promise<CreateMessageReportResponse> => {
  const response = await NetworkLayer.post<CreateMessageReportResponse>(`/messages/${messageId}/reports`, {
    message_report: { comment },
  });
  return response.data;
};
