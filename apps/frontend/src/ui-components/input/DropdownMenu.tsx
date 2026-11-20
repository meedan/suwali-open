import clsx from 'clsx';
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import * as React from "react";

import styles from './DropdownMenu.module.css';

export const DropdownMenu = DropdownMenuPrimitive.Root;

type DropdownMenuTriggerProps = {
  children?: React.ReactNode;
};

export const DropdownMenuTrigger = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Trigger>, DropdownMenuTriggerProps>(({
  children,
  ...props
  }, forwardedRef) => {
    return (
      <DropdownMenuPrimitive.Trigger
        asChild
        {...props}
        ref={forwardedRef}
      >
        {children}
      </DropdownMenuPrimitive.Trigger>
    );
  },
);

type DropdownMenuContentProps = {
  children?: React.ReactNode;
  className?: string;
};

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Content>, DropdownMenuContentProps>(({
  className,
  children,
  ...props
  }, forwardedRef) => {
    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={clsx(
            [styles.menuContent],
            [className],
            )
          }
          {...props}
          collisionPadding={16}
          ref={forwardedRef}
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    );
  },
);

type DropdownMenuItemProps = {
  children?: React.ReactNode;
  className?: string;
};

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Item>, DropdownMenuItemProps>(({
  className,
  children,
  ...props
  }, forwardedRef) => {
    return (
      <DropdownMenuPrimitive.Item
        className={clsx(
          [className],
          )
        }
        {...props}
        ref={forwardedRef}
      >
        {children}
      </DropdownMenuPrimitive.Item>
    );
  },
);

export const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Separator>>(() => (
  <DropdownMenuPrimitive.Separator className={styles.separator} />
));
