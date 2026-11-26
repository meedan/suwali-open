import clsx from 'clsx';
import { Dialog, VisuallyHidden } from "radix-ui";
import { defineMessages, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from "./Modal.module.css";

const messages = defineMessages({
  close: {
    id: 'global.close',
    defaultMessage: 'Close',
    description: 'Reusable label for close dialog buttons or similar',
  },
});

type ModalProps = {
  alert?: boolean;
  trigger?: React.ReactNode;
  triggerDisabled?: boolean;
  actions?: React.ReactNode;
  body: React.ReactNode;
  className?: string;
  details?: React.ReactNode;
  titleContext?: string | React.ReactNode;
  defaultOpen?: boolean;
  disableOpenAutoFocus?: boolean;
  open?: boolean;
  size?: 'small' | 'medium' | 'large' | 'xlarge';
  title?: string | React.ReactNode;
  hideTitle?: boolean;
  description?: string | React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  disableOutsideClose?: boolean;
};

const DialogTrigger = Dialog.Trigger;

const Modal = ({
  alert,
  actions,
  body,
  details,
  className,
  titleContext,
  defaultOpen = false,
  disableOpenAutoFocus = false,
  open,
  size = 'medium',
  title,
  hideTitle = false,
  disableOutsideClose = false,
  trigger,
  triggerDisabled = false,
  description,
  onOpenChange,
}: ModalProps) => {
  const intl = useIntl();

  const handleTriggerClick = (
    event: React.MouseEvent<HTMLSpanElement>,
  ) => {
    if (triggerDisabled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <Dialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {/* The span is needed because `trigger` may not forward props/ref required by `asChild`. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      {trigger && <DialogTrigger asChild><span onClick={handleTriggerClick}>{trigger}</span></DialogTrigger>}
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={clsx(
            styles.dialogContent,
            [className],
            {
              [styles.sizeSmall]: size === 'small',
              [styles.sizeMedium]: size === 'medium',
              [styles.sizeLarge]: size === 'large',
              [styles.sizeXlarge]: size === 'xlarge',
            })
          }
          onInteractOutside={(e) => {
            if (disableOutsideClose) {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (disableOutsideClose) {
              e.preventDefault();
            }
          }}
          onOpenAutoFocus={disableOpenAutoFocus ? (e) => e.preventDefault() : undefined}
        >
          {title && hideTitle && (
            <VisuallyHidden.Root asChild>
              <Dialog.Title>
                {title}
              </Dialog.Title>
            </VisuallyHidden.Root>
          )}
          {title && !hideTitle && (
            <div className={styles.dialogTitle}>
              <Dialog.Title>
                {title}
                {titleContext &&
                  <small>
                    {titleContext}
                  </small>
                }
              </Dialog.Title>
              {!alert &&
                <Dialog.Close asChild>
                  <Button
                    aria-label={intl.formatMessage(messages.close)}
                    iconLeft={<Icon id="x" aria-hidden />}
                    size={size === 'xlarge' ? 'large' : size}
                    themeMode
                    onClick={onOpenChange ? () => onOpenChange(false) : undefined}
                  />
                </Dialog.Close>
              }
            </div>
          )}
          {alert && !title && description && (
            <VisuallyHidden.Root asChild>
              <Dialog.Title>
                {description}
              </Dialog.Title>
            </VisuallyHidden.Root>
          )}
          <VisuallyHidden.Root asChild>
            <Dialog.Description>
              {description}
            </Dialog.Description>
          </VisuallyHidden.Root>
          { details &&
            <div className={styles.detailsRow}>
              {details}
            </div>
          }
          <div
            className={clsx(
              styles.dialogBody,
              {
                [styles.alert]: alert,
              })
            }
          >
            {body}
          </div>
          { actions &&
            <div className={styles.dialogActions}>
              {actions}
            </div>
          }
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export {
  DialogTrigger,
  Modal,
};
