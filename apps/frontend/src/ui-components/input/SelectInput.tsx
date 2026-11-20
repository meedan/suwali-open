import clsx from 'clsx';
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";

import Icon from '@ui-components/layout/Icon';

import styles from './SelectInput.module.css';

interface SelectInputProps {
  id?: string;
  // Names the select when it has no visible label of its own, such as when it shares one with a field beside it
  'aria-label'?: string;
  children?: React.ReactNode;
  label?: string | React.ReactNode;
  helpContent?: string | React.ReactNode;
  placeholder?: string | React.ReactNode;
  // What the closed select shows for the chosen item, when that is shorter than the item in the list
  triggerContent?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  size?: 'small' | 'large';
  multiple?: boolean;
  multipleLabel?: (count: number) => string;
}

export const Select = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, SelectInputProps>(({
  id,
  'aria-label': ariaLabel,
  children,
  label,
  helpContent,
  placeholder,
  triggerContent,
  error,
  disabled = false,
  className,
  size = 'small',
  multiple = false,
  multipleLabel,
  value,
  onValueChange,
  ...props
}, forwardedRef) => {
    const selectedValues = multiple && value ? value.split(',').filter(Boolean) : [];
    const selectedCount = selectedValues.length;

    const handleValueChange = (newValue: string) => {
      if (!multiple) {
        onValueChange?.(newValue);
        return;
      }

      // Ignore the 'any' placeholder value
      if (newValue === 'any') {
        return;
      }

      // Multi-select mode: toggle the value
      const currentValues = value ? value.split(',').filter(Boolean) : [];

      // Special case: if this is the only value and it's being clicked again, deselect it
      if (currentValues.length === 1 && currentValues[0] === newValue) {
        onValueChange?.('');
        return;
      }

      const isSelected = currentValues.includes(newValue);

      const updatedValues = isSelected
        ? currentValues.filter(v => v !== newValue)
        : [...currentValues, newValue];

      onValueChange?.(updatedValues.join(','));
    };

    const displayValue = multiple
      ? (selectedCount > 0 ? (multipleLabel?.(selectedCount) || `${selectedCount} selected`) : placeholder)
      : undefined;

    return (
      <div
        className={clsx(
          'base-input-wrapper',
          [className],
          {
            disabled: disabled,
            errors: error,
            // css-modules-allow-undefined: small is the default size, so it has no styles
            [styles.sizeSmall]: size === 'small',
            [styles.sizeLarge]: size === 'large',
          })
        }
      >
        {label &&
          <div className={styles.titleWrapper}>
            <label className="base-label" htmlFor={id}>{label}</label>
          </div>
        }
        <SelectPrimitive.Root
          value={multiple ? 'any' : value}
          onValueChange={handleValueChange}
          disabled={disabled}
          {...props}
        >
          <SelectPrimitive.Trigger
            className={clsx(
              'base-input',
              [styles.input]
            )}
            aria-label={ariaLabel}
            ref={forwardedRef}
          >
            <SelectPrimitive.Value placeholder={placeholder}>
              {multiple ? displayValue : triggerContent}
            </SelectPrimitive.Value>
            <SelectPrimitive.Icon className={styles.iconWrapper}>
              <Icon id="chevron_down" className={styles.icon} />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content className={styles.content}>
              <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
                <Icon id="chevron_up" className={styles.icon} />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className={styles.viewport}>
                {multiple ? (
                  React.Children.map(children, (child) => {
                    if (!child || !React.isValidElement(child)) return null;
                    const childValue = (child.props as SelectItemProps).value;
                    const isSelected = selectedValues.includes(childValue);
                    return React.cloneElement(child as React.ReactElement<SelectItemProps>, {
                      isSelected,
                      onSelect: (e) => {
                        e.preventDefault();
                      },
                    });
                  })
                ) : (
                  children
                )}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
                <Icon id="chevron_down" className={styles.icon} />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        { helpContent && (
          <div className="base-help-container">
            <span>{helpContent}</span>
          </div>
        )}
        { error && (
          <output className="base-error-container">
            <Icon id="error" aria-hidden />
            <span>{error}</span>
          </output>
        )}
      </div>
    );
  },
);

interface SelectItemProps {
  children?: React.ReactNode;
  value: string;
  onSelect?: React.ReactEventHandler<HTMLDivElement>;
  isSelected?: boolean;
}
export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, SelectItemProps>(({
  children,
  isSelected,
  ...props
}, forwardedRef) => {
    return (
      <SelectPrimitive.Item className={styles.item} {...props} ref={forwardedRef}>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className={styles.itemIndicator}>
          <Icon id="check" className={styles.icon} />
        </SelectPrimitive.ItemIndicator>
        {isSelected && (
          <span className={styles.itemIndicator}>
            <Icon id="check" className={styles.icon} />
          </span>
        )}
      </SelectPrimitive.Item>
    );
  },
);
