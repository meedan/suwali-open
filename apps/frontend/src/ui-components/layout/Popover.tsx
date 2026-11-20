import clsx from 'clsx';
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";

import styles from './Popover.module.css';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

type Side = 'top' | 'bottom' | 'left' | 'right';

type PopoverContentProps = {
  // An arrow pointing at the trigger, for a popover that does not line up with it
  arrow?: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children?: React.ReactNode;
  // For a popover with a list in it that is searched, so it gets shorter as it is typed in: it is kept on the side it
  // opened on. It is otherwise put on the side with room again at every size, so one opened over its trigger, as there
  // was no room under it, moves under it once the list is short enough to fit there.
  holdSide?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  side?: Side;
};

// Its own component, rendered inside the portal below, which only mounts its children while the popover is open. So
// this unmounts on close, and heldSide starts over each time it is opened. It would not if kept in PopoverContent.
const Content = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, PopoverContentProps>(({
  arrow = true, children, className, holdSide = false, side = 'bottom', ...props }, forwardedRef) => {
  const [heldSide, setHeldSide] = React.useState<Side>();

  return (
    <PopoverPrimitive.Content
      className={clsx(
        [styles.content],
        [className],
      )}
      sideOffset={5}
      side={heldSide ?? side}
      {...props}
      // Before the list is re-rendered for what was typed, so the side is the one it was placed on
      onInputCapture={holdSide ? (e) => {
        const placed = e.currentTarget.getAttribute('data-side') as Side | null;
        if (placed && !heldSide) setHeldSide(placed);
      } : undefined}
      ref={forwardedRef}
    >
      {children}
      {arrow && <PopoverPrimitive.Arrow className={styles.arrow} />}
    </PopoverPrimitive.Content>
  );
});

export const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, PopoverContentProps>((props, forwardedRef) => (
  <PopoverPrimitive.Portal>
    {/* Mounted only while open: see Content */}
    <Content {...props} ref={forwardedRef} />
  </PopoverPrimitive.Portal>
));
