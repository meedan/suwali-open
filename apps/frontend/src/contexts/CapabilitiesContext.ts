import { createContext } from 'react';

import type { CanDecision, Capabilities } from '@customTypes/hub';

export type CapabilitiesContextType = {
  can: (action: keyof Capabilities) => CanDecision;
  capabilities: Capabilities | null;
  isLoading: boolean;
};

export const CapabilitiesContext = createContext<CapabilitiesContextType | undefined>(undefined);
