import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import Icon from '@ui-components/layout/Icon';

import styles from './EditableTitle.module.css';

const messages = defineMessages({
  tooltipLabel: {
    id: 'global.rename',
    defaultMessage: 'Rename',
    description: 'Reusable label for rename action',
  },
  confirmLabel: {
    id: 'global.setTitle',
    defaultMessage: 'Set title',
    description: 'Reusable label to confirm the new title of an item',
  },
  cancelLabel: {
    id: 'global.cancel',
    defaultMessage: 'Cancel',
    description: 'Reusable label for cancel buttons',
  },
});

type EditableTitleSharedProps = {
  icon?: React.ReactNode;
  displayValue?: React.ReactNode;
  tooltipLabel?: string | null;
  confirmLabel?: string | null;
  cancelLabel?: string | null;
  renderMeta?: React.ReactNode;
  className?: string;
  size?: 'small' | 'large';
  startEditing?: boolean;
  showConfirm?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onChange?: (value: string) => void;
};

type EditableTitleProps =
  | (EditableTitleSharedProps & { canEdit?: true; value: string; onSave: (newValue: string) => void })
  | (EditableTitleSharedProps & { canEdit: false; value?: string; onSave?: (newValue: string) => void });

const EditableTitle = ({
  icon,
  value = '',
  displayValue,
  onSave = () => {},
  tooltipLabel,
  confirmLabel,
  cancelLabel,
  renderMeta,
  onEditingChange,
  onChange,
  canEdit = true,
  className,
  size = 'large',
  showConfirm = true,
  startEditing = false,
}: EditableTitleProps) => {
  const intl = useIntl();
  const HeadingTag = size === 'large' ? 'h2' : 'h3';
  const resolvedTooltipLabel = tooltipLabel !== undefined ? tooltipLabel : intl.formatMessage(messages.tooltipLabel);
  const resolvedConfirmLabel = confirmLabel !== undefined ? confirmLabel : intl.formatMessage(messages.confirmLabel);
  const resolvedCancelLabel = cancelLabel !== undefined ? cancelLabel : intl.formatMessage(messages.cancelLabel);

  const [isEditing, setIsEditing] = useState(startEditing);
  const [localValue, setLocalValue] = useState(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) setLocalValue(value);
  }, [value, isEditing]);

  const handleConfirm = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const trimmed = localValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLocalValue(value);
    setIsEditing(false);
  }, [value]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, handleCancel]);

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        styles.editableTitleWrapper,
        className,
        {
          [styles.small]: size === 'small',
          [styles.editingTitle]: isEditing,
          'editing-title': isEditing,
        })
      }
    >
      {icon && <div className={clsx('no-mobile-access', styles.titleIcon)}>{icon}</div>}
      <div className={styles.editTitleContainer}>
        <hgroup
          className={clsx(
            styles.hgroup,
            {
              [styles.readOnly]: !canEdit,
            })
          }
        >
          {isEditing ?
            <div className={styles.editInputWrapper}>
              <TextInput
                autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                className={styles.editInput}
                value={localValue}
                onChange={(e) => {
                  setLocalValue(e.target.value);
                  onChange?.(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm();
                  if (e.key === 'Escape') handleCancel();
                }}
              />
              {showConfirm !== false && (
                <div className={styles.editActions}>
                  <Button
                    label={resolvedCancelLabel ?? undefined}
                    size="small"
                    themeMode
                    variant="text"
                    onClick={handleCancel}
                  />
                  <Button
                    label={resolvedConfirmLabel ?? undefined}
                    size="small"
                    onClick={handleConfirm}
                  />
                </div>
              )}
            </div>
            :
            <HeadingTag data-tooltip={canEdit ? resolvedTooltipLabel ?? undefined : undefined} onClick={canEdit ? () => setIsEditing(true) : undefined}>
              {displayValue ?? value}
              { canEdit && size === 'large' &&
                <Button
                  aria-label={intl.formatMessage(messages.tooltipLabel)}
                  className={styles.editIndicator}
                  iconLeft={<Icon id="pencil" aria-hidden />} size="small" themeMode variant="filled"
                  onClick={canEdit ? () => setIsEditing(true) : undefined}
                />
              }
            </HeadingTag>
            }
          {renderMeta &&
            <div className={styles.metaWrapper}>
              {renderMeta}
            </div>
          }
        </hgroup>
      </div>
    </div>
  );
};

export default EditableTitle;
