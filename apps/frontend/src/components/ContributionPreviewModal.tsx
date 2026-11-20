import { FormattedMessage } from "react-intl";

import type { Contribution } from "@customTypes/contribution";
import type { ContributionPreviewItem } from "@customTypes/data-source-item";
import type { PriorityTier } from "@customTypes/priority-tier";

import Icon from '@ui-components/layout/Icon';
import ParsedText from "@ui-components/layout/ParsedText";
import PlatformCaption from "@ui-components/layout/PlatformCaption";
import TrustedUserStatus from "@ui-components/layout/TrustedUserStatus";

import styles from './DocumentPreviewModal.module.css';
import PreviewDetails from './PreviewDetails';
import PreviewDetailsDate from './PreviewDetailsDate';
import PreviewModalBase from "./PreviewModalBase";
import PriorityTierField from './PriorityTierField';
import PriorityTierToggle from './PriorityTierToggle';
import StatusField from './StatusField';
import TopicsMetaItem from "./TopicsMetaItem";

type ContributionPreviewModalProps = {
  contribution: ContributionPreviewItem | Contribution| null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTogglePause?: () => void;
  onTogglePriorityTier?: () => void;
  onTopicAdded?: () => void;
  onTopicDeleted?: () => void;
  priorityTier?: PriorityTier;
};

const ContributionPreviewModal = ({
  contribution,
  open,
  onOpenChange,
  onTogglePause,
  onTogglePriorityTier,
  onTopicAdded,
  onTopicDeleted,
  priorityTier,
}: ContributionPreviewModalProps) => {
  if (!contribution) return null;

  const title = (
    <FormattedMessage
      id="global.endUserContribution"
      defaultMessage="End-user contribution"
      description="Reusable label for End-User Contribution title"
    />
  );

  const titleNode = priorityTier !== undefined ? (
    <span className={styles.titleWrapper}>
      <PriorityTierToggle disabled={contribution.sync_status === 'pending' || contribution.sync_status === 'error'} priorityTier={priorityTier} onToggle={onTogglePriorityTier} variant="filled" />
      {title}
    </span>
  ) : title;

  const details = (
    <PreviewDetails>
      <PreviewDetails.Section>
        {priorityTier !== undefined && (
          <PriorityTierField priorityTier={priorityTier} onToggle={onTogglePriorityTier} syncStatus={contribution.sync_status} />
        )}
        <StatusField active={contribution.active !== false} syncStatus={contribution.sync_status} onToggle={onTogglePause} />
      </PreviewDetails.Section>
      <PreviewDetails.Section>
        <TopicsMetaItem
          stacked
          topics={'topics' in contribution ? contribution.topics : undefined}
          onTopicDeleted={onTopicDeleted}
          addTopic={onTopicAdded ? { itemType: 'Contribution', itemId: contribution.id, onAdded: onTopicAdded } : undefined}
        />
      </PreviewDetails.Section>
      <PreviewDetails.Section>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="global.endUser"
              defaultMessage="End-user"
              description="End-users are members of the audience who interact with the chatbot"
            />
          }
        >
          <div className={styles.person}>
            <Icon id="user" aria-hidden />
            <strong>{contribution.message?.conversation?.participant?.name}</strong>
          </div>
        </PreviewDetails.Field>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.platform"
              defaultMessage="Platform"
              description="Label for the platform where a conversation occurred, such as whatsapp or telegram"
            />
          }
        >
          <PlatformCaption id={contribution.message?.conversation?.platform} />
        </PreviewDetails.Field>
        {contribution.message?.conversation?.participant.type === "ExternalUser" && (
          <PreviewDetails.Field
            label={
              <FormattedMessage
                id="previewDetails.trustedUser"
                defaultMessage="Trusted end-user"
                description="Label for whether the end-user of a conversation is a trusted end-user"
              />
            }
          >
            <TrustedUserStatus
              icon
              label="short"
              trusted={Boolean(contribution.message?.conversation?.participant?.trusted_user)}
            />
          </PreviewDetails.Field>
        )}
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.modified"
              defaultMessage="Modified"
              description="Label for when an item was last modified"
            />
          }
        >
          <PreviewDetailsDate value={contribution.updated_at} />
        </PreviewDetails.Field>
      </PreviewDetails.Section>
    </PreviewDetails>
  );

  const content = (
    <p><ParsedText text={contribution.content} /></p>
  );

  return (
    <PreviewModalBase
      active={contribution.active}
      syncStatus={contribution.sync_status}
      open={open}
      onOpenChange={onOpenChange}
      title={titleNode}
      details={details}
      detailsPlacement="side"
      content={content}
    />
  );
};

export default ContributionPreviewModal;
