import type { IntlShape, MessageDescriptor } from 'react-intl';
import { defineMessages } from 'react-intl';

import type { Hub } from '@customTypes/hub';

export const planMessages = defineMessages({
  trial: {
    id: 'global.freeTrial',
    defaultMessage: 'Free trial',
    description: 'Label indicating the free trial pricing tier',
  },
  trialUnrestricted: {
    id: 'global.freeTrialUnrestricted',
    defaultMessage: 'Free trial (unrestricted)',
    description: 'Plan label for an unrestricted free hub trial',
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

// Every plan, in the order admins choose between them.
const allPlanMessages: Record<Hub['plan'], MessageDescriptor> = {
  free: planMessages.trial,
  free_unrestricted: planMessages.trialUnrestricted,
  subsidized: planMessages.subsidized,
  standard: planMessages.standard,
  pro: planMessages.pro,
  enterprise: planMessages.enterprise,
};

export const allPlans = Object.keys(allPlanMessages) as Hub['plan'][];

// Falls back to the raw value for a plan the API added before the frontend knew it.
export const formatPlanLabel = (intl: IntlShape, plan: string): string => {
  const message = (allPlanMessages as Partial<Record<string, MessageDescriptor>>)[plan];
  return message ? intl.formatMessage(message) : plan;
};
