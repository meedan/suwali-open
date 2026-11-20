export const getWhatsappLink = (phoneNumber: string | null | undefined): string | null => {
  if (!phoneNumber) return null;
  return `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}`;
};

export const getTelegramLink = (botUsername: string | null | undefined): string | null => {
  if (!botUsername) return null;
  return `https://t.me/${botUsername}`;
};

export const getSmsLink = (phoneNumber: string | null | undefined): string | null => {
  if (!phoneNumber) return null;
  return `sms:${phoneNumber.replace(/[^0-9+]/g, '')}`;
};

export const getSignalLink = (phoneNumber: string | null | undefined): string | null => {
  if (!phoneNumber) return null;
  return `https://signal.me/#p/${phoneNumber.replace(/[^0-9+]/g, '')}`;
};

export type StatusTone = 'green' | 'yellow' | 'pink';

// Maps the various messaging-integration status values (WhatsApp quality/connection/name/verification,
// template review, SMS registration) onto a shared traffic-light tone. Values are compared
// case-insensitively so WhatsApp's UPPERCASE and SMS's lowercase statuses share the same buckets.
const STATUS_TONES: Record<StatusTone, string[]> = {
  green: ['GREEN', 'CONNECTED', 'APPROVED', 'AVAILABLE_WITHOUT_REVIEW', 'VERIFIED'],
  yellow: ['YELLOW', 'FLAGGED', 'PENDING', 'PENDING_REVIEW', 'IN_APPEAL', 'PENDING_NEED_MORE_INFO', 'PENDING_SUBMISSION', 'UNREGISTERED', 'BRAND_APPROVED', 'CAMPAIGN_PENDING'],
  pink: ['RED', 'RESTRICTED', 'DECLINED', 'EXPIRED', 'REJECTED', 'PAUSED', 'DISABLED', 'NOT_VERIFIED', 'REVOKED', 'FAILED', 'SUSPENDED'],
};

export const getStatusTone = (status: string | null | undefined): StatusTone | null => {
  if (!status) return null;
  const normalized = status.toUpperCase();
  return (Object.keys(STATUS_TONES) as StatusTone[]).find((tone) => STATUS_TONES[tone].includes(normalized)) || null;
};
