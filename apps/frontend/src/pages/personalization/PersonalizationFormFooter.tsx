import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

import styles from './Personalization.module.css';

const messages = defineMessages({
  cancelButton: {
    id: 'global.cancel',
    defaultMessage: 'Cancel',
    description: 'Reusable label for cancel buttons',
  },
  discardButton: {
    id: 'global.discardChanges',
    defaultMessage: 'Discard changes',
    description: 'Label for a button that resets a form to its last saved values',
  },
  removeButton: {
    id: 'global.remove',
    defaultMessage: 'Remove',
    description: 'Reusable label for remove action',
  },
});

type PersonalizationFormFooterProps = {
  saveLabel: string;
  // Whether there is something valid to save
  canSave: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  // Backs out of the form: cancels adding something new, or discards edits to what was saved
  secondaryAction: 'cancel' | 'discard';
  showSecondary?: boolean;
  onSecondary: () => void;
  // Present when there is something saved that can be removed
  remove?: {
    title: string;
    titleContext: React.ReactNode;
    body: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  };
};

// The actions every personalization form ends with, and the confirmation that guards removing it
const PersonalizationFormFooter = ({
  saveLabel,
  canSave,
  isSubmitting,
  onSave,
  secondaryAction,
  showSecondary = true,
  onSecondary,
  remove,
}: PersonalizationFormFooterProps) => {
  const intl = useIntl();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const onConfirmRemove = async () => {
    await remove?.onConfirm();
    setConfirmingRemove(false);
  };

  return (
    <>
      <div className={styles.buttonWrapper}>
        <Button
          label={saveLabel}
          size="small"
          variant="filled"
          onClick={onSave}
          disabled={isSubmitting || !canSave}
        />
        {showSecondary && (
          <Button
            label={intl.formatMessage(secondaryAction === 'discard' ? messages.discardButton : messages.cancelButton)}
            size="small"
            variant="text"
            themeMode
            onClick={onSecondary}
            disabled={isSubmitting}
          />
        )}
        {remove && (
          <Button
            label={intl.formatMessage(messages.removeButton)}
            size="small"
            variant="text"
            themeMode
            iconLeft={<Icon id="trash" aria-hidden />}
            onClick={() => setConfirmingRemove(true)}
            disabled={isSubmitting}
            className={styles.buttonDelete}
          />
        )}
      </div>

      {remove && (
        <Modal
          alert
          title={remove.title}
          titleContext={remove.titleContext}
          open={confirmingRemove}
          size="small"
          actions={
            <>
              <Button
                label={intl.formatMessage(messages.cancelButton)}
                size="small"
                themeMode
                variant="text"
                onClick={() => setConfirmingRemove(false)}
                disabled={isSubmitting}
              />
              <Button
                label={remove.confirmLabel}
                size="small"
                onClick={onConfirmRemove}
                disabled={isSubmitting}
              />
            </>
          }
          body={remove.body}
        />
      )}
    </>
  );
};

export default PersonalizationFormFooter;
