import type { ExternalUser } from '@customTypes/external-user';

import { NetworkLayer } from '@root/NetworkLayer';

export const updateExternalUserTrustedStatus = async (
  hubId: number | string,
  userId: number,
  trustedUser: boolean,
): Promise<ExternalUser> => {
  const response = await NetworkLayer.patch<ExternalUser>(`/hubs/${hubId}/external-users/${userId}`, {
    external_user: { trusted_user: trustedUser },
  });
  return response.data;
};

export const createExternalUser = async (
  hubId: number | string,
  params: { platform: string; external_id: string },
): Promise<ExternalUser> => {
  const response = await NetworkLayer.post<ExternalUser>(`/hubs/${hubId}/external-users`, {
    external_user: params,
  });
  return response.data;
};
