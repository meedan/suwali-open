import type { MessageDescriptor } from 'react-intl';
import { defineMessages } from 'react-intl';

import type { Hub } from '@customTypes/hub';

export const planMessages = defineMessages({
  trial: {
    id: 'global.trialTierUpsell',
    defaultMessage: 'Free trial!',
    description: 'Generic label for the free trial pricing tier',
  },
  subsidized: {
    id: 'global.subsidizedTier',
    defaultMessage: 'Subsidized',
    description: 'Generic label for the subsidized pricing tier',
  },
  standard: {
    id: 'global.standardTier',
    defaultMessage: 'Standard',
    description: 'Generic label for the standard pricing tier',
  },
  pro: {
    id: 'global.ProTier',
    defaultMessage: 'Pro',
    description: 'Generic label for the pro pricing tier',
  },
  enterprise: {
    id: 'global.enterpriseTier',
    defaultMessage: 'Enterprise',
    description: 'Generic label for the top pricing tier',
  },
});

const planMessageMap: Partial<Record<Hub['plan'], MessageDescriptor>> = {
  subsidized: planMessages.subsidized,
  standard: planMessages.standard,
  pro: planMessages.pro,
  enterprise: planMessages.enterprise,
};

export const getPlanMessageDescriptor = (hub: Hub): MessageDescriptor =>
  planMessageMap[hub.plan] ?? planMessages.trial;
