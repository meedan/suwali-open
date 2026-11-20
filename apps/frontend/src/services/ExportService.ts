import { API_BASE_URL, getAuthToken, HttpError } from '@root/NetworkLayer';

// Shared copy meant to replace AdminService's downloadExport; a raw fetch because NetworkLayer parses every body as JSON
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
