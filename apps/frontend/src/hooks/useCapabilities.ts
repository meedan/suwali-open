import { useContext } from 'react';

import type { CanDecision, Capabilities } from '@customTypes/hub';

import { CapabilitiesContext, type CapabilitiesContextType } from '@contexts/CapabilitiesContext';

export function useCapabilities(): CapabilitiesContextType {
  const context = useContext(CapabilitiesContext);
  if (context === undefined) {
    throw new Error('useCapabilities must be used within a CapabilitiesProvider');
  }
  return context;
}

export function useCan(action: keyof Capabilities): CanDecision {
  const { can } = useCapabilities();
  return can(action);
}
