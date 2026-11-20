import type { AdminHubActivityEvent, AdminHubActivityEventType, AdminHubDetail } from '@services/AdminService';

export type MilestoneKey = 'hub_created' | 'source_added' | 'second_editor_joined' | 'messaging_connected' | 'converted_to_paid';

export type Milestone = {
  key: MilestoneKey;
  at: string | null;
};

// Matches HubLifecycleService::FREE_PLAN_LABELS on the backend.
const FREE_PLAN_LABELS = ['free', 'free_unrestricted'];

// Fallback order for milestones the hub hasn't reached yet — there's no timestamp to sort them by,
// so they render after the reached ones in this order.
const PENDING_ORDER: MilestoneKey[] = ['source_added', 'second_editor_joined', 'messaging_connected', 'converted_to_paid'];

const earliestAt = (events: AdminHubActivityEvent[], type: AdminHubActivityEventType): string | null => {
  const matches = events.filter((event) => event.type === type).map((event) => event.at).sort();
  return matches[0] ?? null;
};

const earliestConversionToPaidAt = (events: AdminHubActivityEvent[]): string | null => {
  const matches = events
    .filter((event) => event.type === 'plan_changed'
      && event.old_plan && FREE_PLAN_LABELS.includes(event.old_plan)
      && event.new_plan && !FREE_PLAN_LABELS.includes(event.new_plan))
    .map((event) => event.at)
    .sort();
  return matches[0] ?? null;
};

// Milestones after creation can happen in any order (e.g. messaging connected before a source was
// ever added), so reached ones are sorted by their real timestamp rather than a fixed sequence —
// only "hub created" is guaranteed first, since nothing can precede a hub's own creation.
export const deriveMilestones = (hub: Pick<AdminHubDetail, 'created_at'>, events: AdminHubActivityEvent[]): Milestone[] => {
  // The earliest membership_added event is always the creator's own auto-membership
  // (HubMembership#set_admin_for_first_member) — real team growth starts at the second one.
  const membershipAddedTimes = events.filter((event) => event.type === 'membership_added').map((event) => event.at).sort();

  const created: Milestone = {key: 'hub_created', at: hub.created_at};
  const rest: Milestone[] = [
    {key: 'source_added', at: earliestAt(events, 'source_added')},
    {key: 'second_editor_joined', at: membershipAddedTimes[1] ?? null},
    {key: 'messaging_connected', at: earliestAt(events, 'messaging_connected')},
    {key: 'converted_to_paid', at: earliestConversionToPaidAt(events)},
  ];

  const reached = rest.filter((milestone) => milestone.at !== null).sort((a, b) => a.at!.localeCompare(b.at!));
  const pending = PENDING_ORDER
    .map((key) => rest.find((milestone) => milestone.key === key)!)
    .filter((milestone) => milestone.at === null);

  return [created, ...reached, ...pending];
};

// Whole calendar days (UTC), not a rounded continuous duration — otherwise a milestone reached 12
// hours later on the same UTC day would round up to "1 day after creation" instead of "Same day".
export const daysSinceCreation = (createdAt: string, at: string): number => {
  const created = new Date(createdAt);
  const target = new Date(at);
  const createdUtcDate = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const targetUtcDate = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.max(0, Math.round((targetUtcDate - createdUtcDate) / (1000 * 60 * 60 * 24)));
};
