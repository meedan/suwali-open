import type { Notebook } from '@customTypes/notebook';
import type { PaginationMetadata } from '@customTypes/pagination-metadata';
import type { Source } from '@customTypes/source';

import { API_BASE_URL, getAuthToken, HttpError, NetworkLayer } from '@root/NetworkLayer';

import type { DocumentsFilter } from '@hooks/useFilterAndSort';

import { getStoredLocale } from '@components/LanguageProvider';

export const fetchSource = async (sourceId: number): Promise<Source> => {
  const response = await NetworkLayer.get<Source>(`/sources/${sourceId}`);
  return response.data;
};

export const fetchSources = async (hubId: number | string): Promise<Source[]> => {
  const response = await NetworkLayer.get<Source[]>(`/hubs/${hubId}/sources`);
  return response.data;
};

export type SourcePreviewResponse = {
  documents: { external_id: string; title: string; content: string; link: string; metadata: { description?: string; url?: string } }[];
  total: number;
  suggested_name: string | null;
  suggested_url?: string | null;
  error?: string;
};

export const previewSource = async (payload: object): Promise<SourcePreviewResponse> => {
  const response = await NetworkLayer.post<SourcePreviewResponse>('/sources/preview', payload);
  return response.data;
};

export type ConfigureSourceResponse = {
  configuration?: {
    type: string | null;
    selectors: { link?: string | null; title?: string | null; body?: string | null };
    pagination?: { multi_page: boolean | null; suggested_website_url?: string | null };
  };
  error?: string;
};

export const configureSource = async (payload: object): Promise<ConfigureSourceResponse> => {
  const response = await NetworkLayer.post<ConfigureSourceResponse>('/sources/configure', payload);
  return response.data;
};

type DetectWordpressResponse = {
  // The address to connect with the WordPress wizard; null when the URL is not a WordPress site
  site_url: string | null;
};

export const detectWordpressSite = async (payload: { hub_id: number | null, url: string }): Promise<DetectWordpressResponse> => {
  const response = await NetworkLayer.post<DetectWordpressResponse>('/sources/detect_wordpress', payload);
  return response.data;
};

type OwnershipCodeResponse = {
  code: string;
  settings_url: string;
  // Where the site's admin approves Suwali; null when the site does not support Application Passwords
  authorize_url: string | null;
};

export const fetchOwnershipCode = async (payload: object): Promise<OwnershipCodeResponse> => {
  const response = await NetworkLayer.post<OwnershipCodeResponse>('/sources/ownership_code', payload);
  return response.data;
};

type VerifyOwnershipResponse = {
  verified: boolean;
  receipt?: string;
  // Only when verifying with an Application Password
  reason?: 'not_admin' | 'rejected';
  password_revoked?: boolean;
};

export const verifySourceOwnership = async (payload: object): Promise<VerifyOwnershipResponse> => {
  const response = await NetworkLayer.post<VerifyOwnershipResponse>('/sources/verify_ownership', payload);
  return response.data;
};

export const createSource = async (payload: object) => {
  const response = await NetworkLayer.post<Source>('/sources', payload);
  return response.data;
};

export const createSourceWithFiles = async (hubId: number, name: string, files: File[]): Promise<Source> => {
  const formData = new FormData();
  formData.append('source[hub_id]', String(hubId));
  formData.append('source[name]', name);
  formData.append('source[source_type]', 'uploaded_files');
  formData.append('source[active]', 'true');
  files.forEach((file) => {
    formData.append('source[files][]', file);
  });

  const response = await fetch(`${API_BASE_URL}/sources`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthToken(),
      'Accept-Language': getStoredLocale(),
    },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new HttpError(response.status, data, response.headers);
  }
  return data;
};

export const updateSourceWithFiles = async (sourceId: number, files: File[]): Promise<Source> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('source[files][]', file);
  });

  const response = await fetch(`${API_BASE_URL}/sources/${sourceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': getAuthToken(),
      'Accept-Language': getStoredLocale(),
    },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new HttpError(response.status, data, response.headers);
  }
  return data;
};

export const updateSource = async (sourceId: number, payload: object) => {
  const response = await NetworkLayer.put<Source>(`/sources/${sourceId}`, payload);
  return response.data;
};

export const patchSource = async (sourceId: number, payload: object): Promise<Source> => {
  const response = await NetworkLayer.patch<Source>(`/sources/${sourceId}`, payload);
  return response.data;
};

type PublishedSummariesResponse = {
  data: Notebook[];
  pagination: PaginationMetadata;
};

export const fetchPublishedSummaries = async (
  hubId: number | string | null,
  page: number,
  perPage: number,
  filter: DocumentsFilter = {},
) => {
  const params = new URLSearchParams({
    published: "true",
    page: page.toString(),
    per_page: perPage.toString(),
    ...filter,
  });

  const response = await NetworkLayer.get<PublishedSummariesResponse>(`/hubs/${hubId}/notebooks?${params.toString()}`);
  return response.data;
};

type DeleteSourceResponse = {
  message: string;
};

type DeleteSourceParams = {
  sourceId: number;
};

export const deleteSource = async ({
  sourceId,
}: DeleteSourceParams) => {
  const response = await NetworkLayer.delete<DeleteSourceResponse>(`/sources/${sourceId}`);
  return response.data;
};

export const updateEntityPriorityTier = async (
  entityType: 'documents' | 'contributions' | 'notebooks',
  entityId: number,
  // narrower than PriorityTier on purpose: the API accepts -1 but no UI sets it
  priorityTier: 1 | 2,
) => {
  const entityKey = entityType.slice(0, -1);
  await NetworkLayer.patch(
    `/${entityType}/${entityId}`,
    { [entityKey]: { priority_tier: priorityTier } }
  );
};

type PauseEntityParams = {
  entityType: 'documents' | 'contributions' | 'notebooks';
  entityId: number;
  active: boolean;
};

export const updateEntityActiveStatus = async ({
  entityType,
  entityId,
  active,
}: PauseEntityParams) => {
  const entityKey = entityType.slice(0, -1); // Remove 's' to get singular form
  await NetworkLayer.patch(
    `/${entityType}/${entityId}`,
    { [entityKey]: { active } }
  );
};

type DeleteEntityParams = {
  entityType: 'documents' | 'contributions';
  entityId: number;
};

export const deleteEntity = async ({
  entityType,
  entityId,
}: DeleteEntityParams) => {
    await NetworkLayer.delete(`/${entityType}/${entityId}`);
};
