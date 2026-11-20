import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { prefersReducedMotion } from '@helpers/motion';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './ConversationJumpButtons.module.css';

const messages = defineMessages({
  jumpToFirstMessage: {
    id: 'global.jumpToFirstMessage',
    defaultMessage: 'Jump to first message',
    description: 'Reusable label for a button that moves a conversation to its first message',
  },
  jumpToLatestMessage: {
    id: 'global.jumpToLatestMessage',
    defaultMessage: 'Jump to latest message',
    description: 'Reusable label for a button that moves a conversation to its latest message',
  },
});

type ConversationJumpButtonsProps = {
  containerElementId: string;
  itemCount: number;
  hasUnloadedOlder: boolean;
  hasUnloadedNewer: boolean;
  onJumpToFirst: () => void;
  onJumpToLatest: () => void;
};

const ConversationJumpButtons = ({
  containerElementId,
  itemCount,
  hasUnloadedOlder,
  hasUnloadedNewer,
  onJumpToFirst,
  onJumpToLatest,
}: ConversationJumpButtonsProps) => {
  const intl = useIntl();
  const [farFromTop, setFarFromTop] = useState(false);
  const [farFromBottom, setFarFromBottom] = useState(false);

  // The container is flex-direction: column-reverse, so scrollTop is 0 at the bottom and negative above it
  const measure = useCallback(() => {
    const wrapper = document.getElementById(containerElementId);
    if (!wrapper) return;

    const distanceFromBottom = -wrapper.scrollTop;
    const distanceFromTop = wrapper.scrollHeight - wrapper.clientHeight - distanceFromBottom;
    setFarFromBottom(distanceFromBottom > wrapper.clientHeight);
    setFarFromTop(distanceFromTop > wrapper.clientHeight);
  }, [containerElementId]);

  useEffect(() => {
    const wrapper = document.getElementById(containerElementId);
    if (!wrapper) return;

    measure();
    wrapper.addEventListener('scroll', measure, { passive: true });
    return () => wrapper.removeEventListener('scroll', measure);
  }, [containerElementId, measure, itemCount]);

  const scrollToEdge = (edge: 'top' | 'bottom') => {
    const wrapper = document.getElementById(containerElementId);
    wrapper?.scrollTo({
      top: edge === 'bottom' ? 0 : -wrapper.scrollHeight,
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    });
  };

  const firstLabel = intl.formatMessage(messages.jumpToFirstMessage);
  const latestLabel = intl.formatMessage(messages.jumpToLatestMessage);

  return (
    <>
      { (hasUnloadedOlder || farFromTop) && (
        <div className={clsx(styles.jumpButtons, styles.top)}>
          <Tooltip content={firstLabel}>
            <Button
              aria-label={firstLabel}
              className={styles.jumpButton}
              themeMode
              size="small"
              iconLeft={<Icon id="arrow_up" aria-hidden />}
              onClick={() => hasUnloadedOlder ? onJumpToFirst() : scrollToEdge('top')}
            />
          </Tooltip>
        </div>
      )}
      { (hasUnloadedNewer || farFromBottom) && (
        <div className={clsx(styles.jumpButtons, styles.bottom)}>
          <Tooltip content={latestLabel}>
            <Button
              aria-label={latestLabel}
              className={styles.jumpButton}
              themeMode
              size="small"
              iconLeft={<Icon id="arrow_down" aria-hidden />}
              onClick={() => hasUnloadedNewer ? onJumpToLatest() : scrollToEdge('bottom')}
            />
          </Tooltip>
        </div>
      )}
    </>
  );
};

export default ConversationJumpButtons;
