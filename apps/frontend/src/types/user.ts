import type { Hub } from "./hub";

export type User = {
  type: "User";
  id: number;
  confirmed: boolean;
  email: string;
  hubs?: Hub[];
  pending_hubs?: Hub[];
  name: string;
  profile_picture_url: string | null;
  is_public_email_domain: boolean;
  is_admin: boolean;
  is_write_admin: boolean;
  // Only returned for your own account, by /me and login
  last_login_at?: string | null;
  last_active_at?: string | null;
};
