import type { Document } from '@customTypes/document';
import type { PaginationMetadata } from '@customTypes/pagination-metadata';

import { NetworkLayer } from '@root/NetworkLayer';

import type { DocumentsFilter } from '@hooks/useFilterAndSort';

type DocumentsResponse = {
  data: Document[];
  pagination: PaginationMetadata;
};

export const fetchDocuments = async (
  sourceId: number,
  page: number,
  perPage: number,
  filter: DocumentsFilter,
): Promise<DocumentsResponse> => {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
    ...filter,
  });
  const response = await NetworkLayer.get<DocumentsResponse>(`/sources/${sourceId}/documents?${queryParams}`);
  return response.data;
};

export const fetchDocument = async (documentId: number): Promise<Document> => {
  const response = await NetworkLayer.get<Document>(`/documents/${documentId}`);
  return response.data;
};

export const updateDocumentSummary = async (documentId: number, summary: string): Promise<Document> => {
  const response = await NetworkLayer.patch<Document>(`/documents/${documentId}`, { document: { summary } });
  return response.data;
};

type RetryDocumentSyncResponse = {
  success: boolean;
};

export const retryDocumentSync = async (documentId: number): Promise<RetryDocumentSyncResponse> => {
  const response = await NetworkLayer.post<RetryDocumentSyncResponse>(`/documents/${documentId}/retry-sync`, {});
  return response.data;
};

type RefreshDocumentResponse = {
  success: boolean;
};

export const refreshDocument = async (documentId: number): Promise<RefreshDocumentResponse> => {
  const response = await NetworkLayer.post<RefreshDocumentResponse>(`/documents/${documentId}/refresh`, {});
  return response.data;
};
