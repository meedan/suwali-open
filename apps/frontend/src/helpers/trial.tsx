import type { Hub } from '@customTypes/hub';

export const isTrial = (hub: Hub) => {
  return !['enterprise', 'subsidized', 'standard', 'pro'].includes(hub.plan);
};

export const isRestricted = (hub: Hub) => {
  return (hub.plan === 'free');
};

export const getDaysRemaining = (trialEndsAt: string | undefined): (number | null) => {
  if (!trialEndsAt) {
    return null;
  }
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
};

export const getTrialRemainingPercent = (hub: Hub): number => {
  if (!hub.trial_started_at || !hub.trial_ends_at) return 0;
  const totalMs = new Date(hub.trial_ends_at).getTime() - new Date(hub.trial_started_at).getTime();
  const elapsedMs = Date.now() - new Date(hub.trial_started_at).getTime();
  return Math.round(100 - Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)));
};
