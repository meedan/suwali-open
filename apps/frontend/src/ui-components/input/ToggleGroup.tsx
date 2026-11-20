import clsx from 'clsx';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import React from 'react';

import styles from './ToggleGroup.module.css';

type ToggleGroupVariant = 'default' | 'menu';

type ToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
  size?: 'small' | 'medium';
  // A menu is a single choice presented as a menu, so the group and its items take menu roles
  variant?: ToggleGroupVariant;
};

// Lets items take the menu item role that goes with a menu group
const ToggleGroupVariantContext = React.createContext<ToggleGroupVariant>('default');

// Size and variant are set once on the group; its items are styled through it
export const ToggleGroup = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Root>, ToggleGroupProps>(({
  className,
  size = 'medium',
  variant = 'default',
  ...props
}, forwardedRef) => (
  <ToggleGroupVariantContext.Provider value={variant}>
    <ToggleGroupPrimitive.Root
      ref={forwardedRef}
      // Only set for menus: Radix gives every other group role="group", which an explicit undefined would remove
      {...(variant === 'menu' && { role: 'menu' })}
      className={clsx(
        styles.toggleGroup,
        {
          [styles.sizeSmall]: size === 'small',
          [styles.sizeMedium]: size === 'medium',
          // css-modules-allow-undefined: default is the default variant, so it has no styles
          [styles.variantDefault]: variant === 'default',
          [styles.variantMenu]: variant === 'menu',
        },
        className,
      )}
      {...props}
    />
  </ToggleGroupVariantContext.Provider>
));

ToggleGroup.displayName = 'ToggleGroup';

// No asChild: the item renders its own icon and label, so it is styled and labelled in one place
type ToggleGroupItemProps = Omit<React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>, 'asChild'> & {
  iconLeft?: React.ReactNode;
};

export const ToggleGroupItem = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Item>, ToggleGroupItemProps>(({
  children,
  className,
  iconLeft,
  ...props
}, forwardedRef) => {
  const variant = React.useContext(ToggleGroupVariantContext);

  return (
    <ToggleGroupPrimitive.Item
      ref={forwardedRef}
      // menuitemradio keeps the aria-checked Radix sets, which a menu's items need to show the choice.
      // Only set for menus, so every other item keeps Radix's own role="radio".
      {...(variant === 'menu' && { role: 'menuitemradio' })}
      className={clsx(styles.toggleGroupItem, className)}
      {...props}
    >
      {iconLeft && <span className={styles.iconLeft}>{iconLeft}</span>}
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = 'ToggleGroupItem';
