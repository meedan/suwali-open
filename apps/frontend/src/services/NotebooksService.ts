import type { Note } from '@customTypes/note';
import type { Notebook } from '@customTypes/notebook';
import type { NotebookItem, NotebookItemTypes } from '@customTypes/notebook-item';
import type { PaginationMetadata } from '@customTypes/pagination-metadata';
import type { PermalinkPaginationMetadata } from '@customTypes/permalink-pagination-metadata';

import { NetworkLayer } from '@root/NetworkLayer';

export type NotebooksResponse = {
  data: Notebook[];
  pagination: PaginationMetadata;
};

export const fetchNotebooks = async (hubId: number | string | null) => {
  if (!hubId) return;
  const response = await NetworkLayer.get<NotebooksResponse>(`/hubs/${hubId}/notebooks`);
  return response.data;
};

type NotebooksPaginatedResponse = {
  data: Notebook[];
  pagination: PermalinkPaginationMetadata;
};

// Permalink pagination with aroundId and windowSize
export const fetchNotebooksPaginated = async (
  hubId: number | string | null,
  aroundId: number | null = null,
  windowSize: number = 20,
  sortBy: string = 'created_at',
  sortDirection: string = 'desc',
) => {
  // The query is disabled without a hub, and TanStack Query rejects an undefined result anyway
  if (!hubId) throw new Error('A hub is required to list notebooks');

  const params = new URLSearchParams();

  if (aroundId) {
    params.append('around_id', aroundId.toString());
  }

  params.append('window_size', windowSize.toString());
  params.append('sort_by', sortBy);
  params.append('sort_direction', sortDirection);

  const response = await NetworkLayer.get<NotebooksPaginatedResponse>(
    `/hubs/${hubId}/notebooks?${params.toString()}`
  );

  return response.data;
};

export const fetchItems = async (notebookId: number | string | undefined) => {
  if (!notebookId) return;
  const response = await NetworkLayer.get<NotebookItem[]>(`/notebooks/${notebookId}/items`);
  return response.data;
};

// An asset's notebook memberships: each row carries its notebook, not the item
export type AssetNotebookItem = {
  id: number;
  item_id: number;
  item_type: NotebookItemTypes;
  notebook_id: number;
  created_at: string;
  updated_at: string;
  notebook: Notebook;
};

export const fetchNotebookItems = async (path: string) => {
  const response = await NetworkLayer.get<AssetNotebookItem[]>(path);
  return response.data;
};

export const fetchNotebookSummary = async (notebookId?: number) => {
  if (!notebookId) return;

  const response = await NetworkLayer.get<Notebook>(`/notebooks/${notebookId}`);
  return response.data;
};

export type AddToNotebookResponse = {
  id: number;
  item_id: number;
  item_type: NotebookItemTypes;
  notebook_id: number;
  created_at: string;
  updated_at: string;
};

export const mutateAddToNotebook = async (
  notebookId: number | string,
  itemId: number,
  assetType: string,
) => {
  const response = await NetworkLayer.post<AddToNotebookResponse>(`/notebooks/${notebookId}/items`, { item_type: assetType, item_id: itemId });
  return response.data;
};

export type DeleteResponse = {
  message: string;
};

export const mutateRemoveFromNotebook = async (
  notebookId: number | string,
  notebookItemId: number,
) => {
  const response = await NetworkLayer.delete<DeleteResponse>(`/notebooks/${notebookId}/items/${notebookItemId}`);
  return response.data;
};

export const createNotebook = async (payload: object): Promise<Notebook> => {
  const response = await NetworkLayer.post<Notebook>('/notebooks', payload);
  return response.data;
};

export const deleteNote = async (noteId: number) => {
  const response = await NetworkLayer.delete<DeleteResponse>(`/notes/${noteId}`);
  return response.data;
};

export const deleteNotebook = async (notebookId: number) => {
  const response = await NetworkLayer.delete<DeleteResponse>(`/notebooks/${notebookId}`);
  return response.data;
};

export const deleteNotebookItem = async (notebookId: number, itemId: number) => {
  const response = await NetworkLayer.delete<DeleteResponse>(`/notebooks/${notebookId}/items/${itemId}`);
  return response.data;
};

export const updateNote = async (note: Partial<Note>): Promise<Note> => {
  const response = await NetworkLayer.patch<Note>(`/notes/${note.id}`, { note: note });
  return response.data;
};

export const updateNotebook = async (notebook: Partial<Notebook>): Promise<Notebook> => {
  const response = await NetworkLayer.patch<Notebook>(`/notebooks/${notebook.id}`, { notebook: notebook });
  return response.data;
};

export const publishNotebook = async (notebookId: number): Promise<Notebook> => {
  const response = await NetworkLayer.patch<Notebook>(`/notebooks/${notebookId}`, { notebook: { notebook_id: notebookId, published: true } });
  return response.data;
};

export const unpublishNotebook = async (notebookId: number): Promise<Notebook> => {
  const response = await NetworkLayer.patch<Notebook>(`/notebooks/${notebookId}`, { notebook: { notebook_id: notebookId, published: false } });
  return response.data;
};

type RetryNotebookSyncResponse = {
  success: boolean;
};

export const retryNotebookSync = async (notebookId: number) => {
  const response = await NetworkLayer.post<RetryNotebookSyncResponse>(`/notebooks/${notebookId}/retry-sync`, {});
  return response.data;
};

type RegenerateSummaryResponse = {
  acknowledged: boolean;
};

export const regenerateSummary = async (notebookId: number) => {
  const response = await NetworkLayer.post<RegenerateSummaryResponse>(`/notebooks/${notebookId}/regenerate-ai-summary`, {});
  return response.data;
};
