// WordPress sends the site's admin back to this page after they approve or reject Suwali. It must
// match WordpressOwnership::AUTHORIZED_PATH in the CMS API.
export const WORDPRESS_AUTHORIZED_PATH = '/wordpress/authorized';

// The approval page runs in a popup that may lose its `window.opener` (a site's
// Cross-Origin-Opener-Policy severs it), so it reports back over a same-origin channel instead.
export const WORDPRESS_AUTHORIZATION_CHANNEL = 'suwali-wordpress-authorization';

export type WordpressAuthorizationResult =
  | { state: string; status: 'approved'; userLogin: string; password: string }
  | { state: string; status: 'rejected' | 'disabled' };

// Reads the query string WordPress appends to the success URL: `site_url`, `user_login` and
// `password` on approval, `success=false` (and `error=disabled` when the feature is off) otherwise
export const parseWordpressAuthorization = (search: string): WordpressAuthorizationResult | null => {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  if (!state) return null;

  const userLogin = params.get('user_login');
  const password = params.get('password');
  if (userLogin && password) return { state, status: 'approved', userLogin, password };

  return { state, status: params.get('error') === 'disabled' ? 'disabled' : 'rejected' };
};

// The state the CMS API put in the success URL, which ties a result to the approval this wizard asked for
export const authorizationStateOf = (authorizeUrl: string): string | null => {
  try {
    const successUrl = new URL(authorizeUrl).searchParams.get('success_url');
    return successUrl ? new URL(successUrl).searchParams.get('state') : null;
  } catch {
    return null;
  }
};
