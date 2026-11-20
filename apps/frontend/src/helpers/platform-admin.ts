import type { MessageDescriptor } from 'react-intl';
import { defineMessages } from 'react-intl';

import type { AdminHub } from '@services/AdminService';

export const dateFormatOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

// Use for date-only fields stored as datetimes (e.g. trial_ends_at) so the
// displayed date is always the UTC calendar date — consistent with what the
// date input sends and what the server stores.
export const utcDateFormatOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
};

export const datetimeFormatOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
};

export function formatLimit(count: number = 0, max: number | null, unlimitedLabel?: string): string {
  if (typeof max === 'number') return `${count.toLocaleString()} / ${max.toLocaleString()}`;
  if (unlimitedLabel) return `${count.toLocaleString()} / ${unlimitedLabel}`;
  return count.toLocaleString();
}

export function formatMaxLimit(max: number | null, unlimitedLabel: string): string {
  return max !== null ? max.toLocaleString() : unlimitedLabel;
}

// Converts an ISO datetime string to a YYYY-MM-DD value for <input type="date">,
// using UTC to match utcDateFormatOptions and what the server stores.
export const toDateInputValue = (isoString: string): string => {
  const d = new Date(isoString);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

export type StatusColor = 'green' | 'yellow' | 'pink';
export type TooltipColumn = 'trial' | 'editors' | 'documents' | 'conversations';

export const getTrialStatus = (trialExpired: boolean, trialEndsAt: string | null): StatusColor | null => {
  if (trialExpired) return 'pink';
  if (!trialEndsAt) return null;
  const days = (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days > 14) return 'green';
  if (days > 7) return 'yellow';
  return 'pink';
};

export const getDocumentActivityStatus = (lastAt: string | null): StatusColor => {
  if (!lastAt) return 'pink';
  const days = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 7) return 'green';
  if (days <= 14) return 'yellow';
  return 'pink';
};

export const getActivityStatus = (lastAt: string | null): StatusColor => {
  if (!lastAt) return 'pink';
  const hours = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60);
  if (hours <= 24) return 'green';
  if (hours <= 168) return 'yellow';
  return 'pink';
};

export const getEditorsStatus = (unapprovedCount: number, unconfirmedCount: number): StatusColor => {
  if (unapprovedCount > 0) return 'pink';
  if (unconfirmedCount > 0) return 'yellow';
  return 'green';
};

export type HubStatusFilter = 'all' | StatusColor;
export type HubPlanFilter = 'all' | 'free' | 'free_unrestricted' | 'subsidized' | 'standard' | 'pro' | 'enterprise' | 'expired_trial';

export const getHubOverallStatus = (hub: AdminHub): StatusColor => {
  const suppressExternalData = hub.trial_active && hub.plan !== 'free_unrestricted';
  const statuses: Array<StatusColor | null> = [
    getTrialStatus(hub.trial_expired, hub.trial_ends_at),
    getEditorsStatus(hub.unapproved_editors_count, hub.unconfirmed_editors_count),
    hub.document_errors_count > 0 ? 'pink' : null,
    hub.sources_count === 0 ? 'pink' : null,
    getDocumentActivityStatus(hub.last_document_added_at),
    getActivityStatus(hub.last_internal_conversation_at),
  ];
  if (!suppressExternalData) {
    statuses.push(
      hub.active_external_users_count === 0 ? 'pink' : null,
      getActivityStatus(hub.last_external_conversation_at),
    );
  }
  if (statuses.includes('pink')) return 'pink';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
};

export const getStatusIcon = (status: StatusColor): string => {
  if (status === 'green') return 'check_filled';
  if (status === 'yellow') return 'countdown_filled';
  return 'error_filled';
};

const tooltipMessages: Record<TooltipColumn, Record<StatusColor, MessageDescriptor>> = {
  trial: defineMessages({
    green: {
      id: 'admin.statusTooltip.trial.green',
      defaultMessage: 'Trial active, more than 14 days remaining: {date}',
      description: 'Tooltip for a hub plan cell showing green trial status, {date} is the trial end date',
    },
    yellow: {
      id: 'admin.statusTooltip.trial.yellow',
      defaultMessage: 'Trial active, 7-14 days remaining — expiring soon: {date}',
      description: 'Tooltip for a hub plan cell showing yellow trial status, {date} is the trial end date',
    },
    pink: {
      id: 'admin.statusTooltip.trial.pink',
      defaultMessage: 'Trial expiring within 7 days, or already expired: {date}',
      description: 'Tooltip for a hub plan cell showing pink trial status',
    },
  }),
  editors: defineMessages({
    green: {
      id: 'admin.statusTooltip.editors.green',
      defaultMessage: 'All editors confirmed and approved',
      description: 'Tooltip for a hub editors cell showing green status',
    },
    yellow: {
      id: 'admin.statusTooltip.editors.yellow',
      defaultMessage: 'One or more editors have not confirmed their email',
      description: 'Tooltip for a hub editors cell showing yellow status',
    },
    pink: {
      id: 'admin.statusTooltip.editors.pink',
      defaultMessage: 'One or more editors are waiting for hub approval',
      description: 'Tooltip for a hub editors cell showing pink status',
    },
  }),
  documents: defineMessages({
    green: {
      id: 'admin.statusTooltip.documents.green',
      defaultMessage: 'A document was added or synced within the last 7 days: {date}',
      description: 'Tooltip for a hub documents cell showing green status, {date} is the date of last document activity',
    },
    yellow: {
      id: 'admin.statusTooltip.documents.yellow',
      defaultMessage: 'Last document activity was 7–14 days ago: {date}',
      description: 'Tooltip for a hub documents cell showing yellow status, {date} is the date of last document activity',
    },
    pink: {
      id: 'admin.statusTooltip.documents.pink',
      defaultMessage: 'No document activity in over 14 days: {date}',
      description: 'Tooltip for a hub documents cell showing pink status, {date} is the date of last document activity',
    },
  }),
  conversations: defineMessages({
    green: {
      id: 'admin.statusTooltip.conversations.green',
      defaultMessage: 'Conversation activity within the last 24 hours: {date}',
      description: 'Tooltip for a hub conversations cell showing green status, {date} is the datetime of last conversation',
    },
    yellow: {
      id: 'admin.statusTooltip.conversations.yellow',
      defaultMessage: 'Last conversation was 1–7 days ago: {date}',
      description: 'Tooltip for a hub conversations cell showing yellow status, {date} is the datetime of last conversation',
    },
    pink: {
      id: 'admin.statusTooltip.conversations.pink',
      defaultMessage: 'No conversation activity in over 7 days: {date}',
      description: 'Tooltip for a hub conversations cell showing pink status, {date} is the datetime of last conversation',
    },
  }),
};

export const getStatusTooltip = (column: TooltipColumn, status: StatusColor): MessageDescriptor =>
  tooltipMessages[column][status];
