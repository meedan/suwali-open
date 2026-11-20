import type { User } from '@customTypes/user';

import {
  clearAuthToken,
  NetworkLayer,
  setAuthToken,
} from '@root/NetworkLayer';

type LoginResponse = {
  message?: string;
  user?: User;
  error?: string;
  error_code?: string;
};

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await NetworkLayer.post<LoginResponse>('/login', { user: { email, password } });
  const authToken = response.headers.get('Authorization');

  if (authToken) {
    setAuthToken(authToken);
  }
  return response.data;
};

export const logout = async (): Promise<void> => {
  try {
    await NetworkLayer.delete('/logout');
  } finally {
    clearAuthToken();
  }
};

type SignupResponse = {
  message?: string;
  error?: string;
  errors?: string[] | string;
};

export const signup = async (email: string, password: string, inviteCode: string): Promise<SignupResponse> => {
  const response = await NetworkLayer.post<SignupResponse>('/signup', { user: { email, password, invite_code: inviteCode } });
  return response.data;
};

type ResetPasswordResponse = {
  message?: string;
  errors?: string[];
};

export const resetPassword = async (email: string): Promise<ResetPasswordResponse> => {
  const response = await NetworkLayer.post<ResetPasswordResponse>('/password', { user: { email } });
  return response.data;
};

type ChangePasswordResponse = {
  message?: string;
  errors?: string[];
};

export const changePassword = async (password: string, token: string): Promise<ChangePasswordResponse> => {
  const response = await NetworkLayer.put<ChangePasswordResponse>('/password', { user: { password, password_confirmation: password, reset_password_token: token } });
  return response.data;
};

type UpdatePasswordResponse = {
  message?: string;
  errors?: string[];
};

export const updatePassword = async (currentPassword: string, password: string): Promise<UpdatePasswordResponse> => {
  const response = await NetworkLayer.patch<UpdatePasswordResponse>('/me/password', {
    user: {
      current_password: currentPassword,
      password,
      password_confirmation: password,
    },
  });

  const authToken = response.headers.get('Authorization');
  if (authToken) {
    setAuthToken(authToken);
  }

  return response.data;
};

type ConfirmEmailResponse = {
  success: boolean;
};

export const confirmEmail = async (token: string): Promise<ConfirmEmailResponse> => {
  const response = await NetworkLayer.post<ConfirmEmailResponse>('/confirmation', { confirmation_token: token });
  return response.data;
};

type ResendConfirmationResponse = {
  success: boolean;
};

export const resendConfirmation = async (email: string): Promise<ResendConfirmationResponse> => {
  const response = await NetworkLayer.post<ResendConfirmationResponse>('/resends', { user: { email } });
  return response.data;
};
