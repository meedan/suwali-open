import type { ReactNode } from 'react';

import type { CanDecision, Capabilities } from '@customTypes/hub';

import { useSession } from '@root/SessionContext';

import { CapabilitiesContext, type CapabilitiesContextType } from '@contexts/CapabilitiesContext';

type CapabilitiesProviderProps = {
  children: ReactNode;
};

export function CapabilitiesProvider({ children }: CapabilitiesProviderProps) {
  const session = useSession();
  const hub = session.currentHub();

  const can = (action: keyof Capabilities): CanDecision => {
    // Platform-admin capabilities depend only on the user, so a super-admin with no hub still has them
    if (action === 'IS_ADMIN' || action === 'IS_WRITE_ADMIN') {
      const allowed = Boolean(action === 'IS_ADMIN' ? session.user?.is_admin : session.user?.is_write_admin);
      return allowed ? { allowed } : { allowed, reasons: ['insufficient_permissions'] };
    }
    if (!hub?.hub_membership?.capabilities) {
      return { allowed: false, reasons: ['loading'] };
    }
    return hub.hub_membership.capabilities[action] || { allowed: false, reasons: ['unknown_action'] };
  };

  const value: CapabilitiesContextType = {
    can,
    capabilities: hub?.hub_membership?.capabilities || null,
    isLoading: false,
  };

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}
