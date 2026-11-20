import { FormattedMessage } from 'react-intl';

import type { TemplateCategory } from '@customTypes/messaging-integration';

import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './MessagingIntegrations.module.css';

type Props = {
  status: string;
  category: TemplateCategory | null;
  className: string;
};

const MarketingTooltip = ({ status }: { status: string }) => (
  status === 'PENDING' ? (
    <FormattedMessage
      id="messagingIntegrations.templateMarketingPendingTooltip"
      defaultMessage="This template’s category has been re-classified as “marketing”. You can appeal this decision with Meta once the template has been approved."
      description="Tooltip for a WhatsApp message template that is still pending review and that Meta classified as marketing instead of utility, which can be appealed with Meta only after approval"
    />
  ) : (
    <FormattedMessage
      id="messagingIntegrations.templateMarketingTooltip"
      defaultMessage="This template’s category has been re-classified as “marketing”. You can appeal this decision with Meta."
      description="Tooltip for a WhatsApp message template that Meta classified as marketing instead of utility, which can be appealed with Meta"
    />
  )
);

const TemplateStatusBadge = ({ status, category, className }: Props) => {
  if (category !== 'MARKETING') {
    return <span className={className}>{status}</span>;
  }

  return (
    <Tooltip content={<MarketingTooltip status={status} />}>
      <button type="button" className={className}>
        {status}
        <Icon id="info_filled" aria-hidden className={styles.templateInfoIcon} />
      </button>
    </Tooltip>
  );
};

export default TemplateStatusBadge;
