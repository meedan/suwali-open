import clsx from 'clsx';
import { Toast as ToastPrimitive } from "radix-ui";
import React from "react";
import { defineMessages, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './Toast.module.css';

const messages = defineMessages({
  close: {
    id: 'global.close',
    defaultMessage: 'Close',
    description: 'Reusable label for close dialog buttons or similar',
  },
});

export type ToastVariant = 'default' | 'success' | 'error';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastNotificationProps = {
  action?: ToastAction;
  children?: React.ReactNode;
  title?: string;
  variant?: ToastVariant;
  onOpenChange?: (open: boolean) => void;
};

export const ToastNotification = ({ action, title, children, variant = 'default', onOpenChange }: ToastNotificationProps) => {
  const intl = useIntl();

  return (
    <ToastPrimitive.Root
      className={clsx(
        [styles.root],
        {
          [styles.variantSuccess]: variant === 'success',
          [styles.variantError]: variant === 'error',
        })
      }
      onOpenChange={onOpenChange}
    >
      {variant === 'success' && <Icon id="check_seal" className={styles.icon} />}
      {variant === 'error' && <Icon id="error" className={styles.icon} />}
      <div className={styles.content}>
        {title && <ToastPrimitive.Title className={styles.title}>{title}</ToastPrimitive.Title>}
        <ToastPrimitive.Description className={styles.description}>{children}</ToastPrimitive.Description>
        {action &&
          <ToastPrimitive.Action altText={action.label} asChild>
            <Button
              className={styles.actionButton}
              label={action.label}
              size="small"
              themeMode
              variant="filled"
              onClick={action.onClick}
            />
          </ToastPrimitive.Action>
        }
      </div>
      <ToastPrimitive.Close
        className={styles.close}
        asChild
      >
        <Button
          aria-label={intl.formatMessage(messages.close)}
          iconLeft={<Icon id="x" aria-hidden />}
          size="small"
          themeMode
          variant="filled"
        />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
};

