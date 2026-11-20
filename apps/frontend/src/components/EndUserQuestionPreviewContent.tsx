import { FormattedMessage } from 'react-intl';

import type { ClusterMessage } from '@customTypes/message-cluster';

import { useClusterMessages } from '@hooks/useClusterMessages';

import Button from '@ui-components/input/Button';
import DatePill from '@ui-components/layout/DatePill';
import Icon from '@ui-components/layout/Icon';
import MessageBubble from '@ui-components/layout/MessageBubble';

import MessageTimestamp from '@components/MessageTimestamp';

import styles from './EndUserQuestionPreviewModal.module.css';

type EndUserQuestionNavigationProps = {
  pagination: ReturnType<typeof useClusterMessages>['pagination'];
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
};

export const EndUserQuestionNavigation = ({
  pagination,
  page,
  setPage,
}: EndUserQuestionNavigationProps) => (
  <div className={styles.navigation}>
    <Button
      size="small"
      label={
        <FormattedMessage
          id="global.previous"
          defaultMessage="Previous"
          description="Generic button or label text for navigating back"
        />
      }
      iconLeft={<Icon id="chevron_left" aria-hidden />}
      disabled={pagination?.first_page}
      onClick={() => setPage(p => p - 1)}
      themeMode
    />
    <FormattedMessage
      id="endUserQuestionPreviewModal.questionCount"
      defaultMessage="{page} of {total}"
      description="Current question index out of total questions asked by end-users"
      tagName="strong"
      values={{ page, total: pagination?.total_count }}
    />
    <Button
      size="small"
      label={
        <FormattedMessage
          id="global.next"
          defaultMessage="Next"
          description="Generic button or label text for navigating forwards"
        />
      }
      iconRight={<Icon id="chevron_right" aria-hidden />}
      disabled={pagination?.last_page}
      onClick={() => setPage(p => p + 1)}
      themeMode
    />
  </div>
);

type EndUserQuestionChatProps = {
  currentMessage: ClusterMessage | undefined;
};

export const EndUserQuestionChat = ({ currentMessage }: EndUserQuestionChatProps) => {
  const messageDate = currentMessage?.created_at ? new Date(currentMessage.created_at) : undefined;

  return (
    <div className={styles.chat}>
      {messageDate && <DatePill size="medium" value={messageDate} />}
      {currentMessage && (
        <MessageBubble
          direction="incoming"
          size="medium"
          timestamp={<MessageTimestamp timestamp={currentMessage.created_at} />}
        >
          {currentMessage.body}
        </MessageBubble>
      )}
      {currentMessage?.reply && (
        <MessageBubble
          size="medium"
          timestamp={
            currentMessage.reply.created_at
              ? <MessageTimestamp timestamp={currentMessage.reply.created_at} />
              : undefined
          }
        >
          {currentMessage.reply.body}
        </MessageBubble>
      )}
    </div>
  );
};
