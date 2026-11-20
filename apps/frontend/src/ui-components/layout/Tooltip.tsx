import { Tooltip as TooltipPrimitive } from 'radix-ui';

import styles from './Tooltip.module.css';

type TooltipProps = {
  children?: React.ReactNode;
  content?: string | React.ReactNode;
  // The child is a disabled button, which gets no pointer events, so the tooltip hangs off a wrapper
  disabled?: boolean;
  open?: boolean;
};

const Tooltip = ({
  children,
  content,
  disabled,
  open,
  ...props
}: TooltipProps) => {
  return (
    <TooltipPrimitive.Root
      open={open}
    >
      <TooltipPrimitive.Trigger asChild>
        {disabled ? <span className={styles.disabledTrigger}>{children}</span> : children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={5} className={styles.tooltipContent} align="center" {...props}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

export default Tooltip;
