import { describe, expect, it } from 'vitest';

import { authorizationStateOf, parseWordpressAuthorization } from './wordpressAuthorization';

describe('parseWordpressAuthorization', () => {
  it('reads an approval', () => {
    const search = '?state=abc&site_url=https%3A%2F%2Fblog.example.com&user_login=admin&password=abcd+EFGH+1234';

    expect(parseWordpressAuthorization(search)).toEqual({
      state: 'abc', status: 'approved', userLogin: 'admin', password: 'abcd EFGH 1234',
    });
  });

  it('reads a rejection', () => {
    expect(parseWordpressAuthorization('?state=abc&success=false')).toEqual({ state: 'abc', status: 'rejected' });
  });

  it('tells when Application Passwords are turned off for the user', () => {
    expect(parseWordpressAuthorization('?state=abc&success=false&error=disabled')).toEqual({ state: 'abc', status: 'disabled' });
  });

  it('ignores a page opened without a state', () => {
    expect(parseWordpressAuthorization('?user_login=admin&password=x')).toBeNull();
  });
});

describe('authorizationStateOf', () => {
  it('finds the state in the success URL', () => {
    const successUrl = 'https://app.suwali.io/wordpress/authorized?state=signed--state';
    const authorizeUrl = `https://blog.example.com/wp-admin/authorize-application.php?app_name=Suwali&success_url=${encodeURIComponent(successUrl)}`;

    expect(authorizationStateOf(authorizeUrl)).toBe('signed--state');
  });

  it('is null for a URL without one', () => {
    expect(authorizationStateOf('https://blog.example.com/wp-admin/authorize-application.php')).toBeNull();
    expect(authorizationStateOf('not a url')).toBeNull();
  });
});
