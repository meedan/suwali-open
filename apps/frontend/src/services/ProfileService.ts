import type { User } from "@customTypes/user";

import { API_BASE_URL, getAuthToken, HttpError, NetworkLayer } from "@root/NetworkLayer";

type MeResponse = {
  user: User;
};

export const fetchMe = async (): Promise<User> => {
  const response = await NetworkLayer.get<MeResponse>('/me');

  if (response.data.user) {
    return response.data.user;
  }

  throw new Error('Failed to fetch user data');
};

type UpdateProfileParams = {
  name?: string;
  file?: File | null;
};

export const updateProfile = async ({
  name,
  file,
}: UpdateProfileParams): Promise<User | null> => {
  const formData = new FormData();

  if (name) {
    formData.append("user[name]", name);
  }

  if (file) {
    formData.append("user[profile_picture]", file);
  }

  const response = await fetch(`${API_BASE_URL}/me`, {
    method: 'PATCH',
    body: formData,
    headers: {
      'Authorization': getAuthToken(),
      "Accept": "*/*",
      // DO NOT set Content-Type manually — fetch will set the correct multipart boundary for you
    }
  });

  let data: User | null = null;

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
