import { useIntl } from 'react-intl';

import { logout } from '@services/AuthService';

import { useToast } from './useToast';

export function useLogout() {
  const intl = useIntl();
  const { toast } = useToast();

  return () => {
    logout()
      .then(() => {
        window.location.href = '/';
      })
      .catch(error => {
        console.error('Error during logout:', error);
        toast('error', intl.formatMessage({
          id: 'global.logoutError',
          defaultMessage: 'An error occurred while signing out. Please try again.',
          description: 'Error message shown to user when there is a problem logging out',
        }));
      });
  };
}
