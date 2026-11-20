import type { ExternalResource, ResourceType, Scenario } from "@customTypes/external-resource";

import { NetworkLayer } from "@root/NetworkLayer";

type CreateExternalResourceParams = {
  hub_id: number;
  resource_type: ResourceType;
  scenarios: Scenario[];
  title: string;
  description?: string;
};

type UpdateExternalResourceParams = {
  resource_type?: ResourceType;
  scenarios?: Scenario[];
  title?: string;
  description?: string;
};

export const fetchExternalResources = async (hubId: number | string): Promise<ExternalResource[]> => {
  const response = await NetworkLayer.get<ExternalResource[]>(`/hubs/${hubId}/external-resources`);
  return response.data;
};

type CreateExternalResourceServiceParams = {
  params: CreateExternalResourceParams;
};

export const createExternalResource = async ({
  params,
}: CreateExternalResourceServiceParams): Promise<ExternalResource> => {
  const response = await NetworkLayer.post<ExternalResource>(`/external-resources`, { external_resource: params });
  return response.data;
};

type UpdateExternalResourceServiceParams = {
  resourceId: number;
  params: UpdateExternalResourceParams;
};

export const updateExternalResource = async ({
  resourceId,
  params,
}: UpdateExternalResourceServiceParams): Promise<ExternalResource> => {
  const response = await NetworkLayer.patch<ExternalResource>(`/external-resources/${resourceId}`, { external_resource: params });
  return response.data;
};

type DeleteExternalResourceParams = {
  resourceId: number;
};

type DeleteExternalResourceResponse = {
  message: string;
};

export const deleteExternalResource = async ({
  resourceId
}: DeleteExternalResourceParams): Promise<DeleteExternalResourceResponse>  => {
  const response = await NetworkLayer.delete<DeleteExternalResourceResponse>(`/external-resources/${resourceId}`);
  return response.data;
};
