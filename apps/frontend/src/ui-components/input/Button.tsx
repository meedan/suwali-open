import clsx from 'clsx';
import React from 'react';
import { Link } from 'react-router';

import styles from './Button.module.css';

// Shared props for visual styling
type ButtonBaseProps = {
  active?: boolean;
  className?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  label?: string | React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  themeMode?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'filled' | 'text' | 'menu';
};

// Default values for button styling props
const DEFAULT_BUTTON_PROPS = {
  active: false,
  orientation: 'horizontal' as const,
  size: 'medium' as const,
  variant: 'filled' as const,
};

// Helper to generate button classNames
function getButtonClassNames({
  className,
  themeMode,
  active = DEFAULT_BUTTON_PROPS.active,
  variant = DEFAULT_BUTTON_PROPS.variant,
  size = DEFAULT_BUTTON_PROPS.size,
  orientation = DEFAULT_BUTTON_PROPS.orientation,
}: ButtonBaseProps): string {
  return clsx(
    [styles.button],
    [className],
    {
      [styles.themeMode]: themeMode,
      [styles.active]: active,
      // css-modules-allow-undefined: filled is the default variant, so it has no styles
      [styles.variantFilled]: variant === 'filled',
      [styles.variantText]: variant === 'text',
      [styles.variantMenu]: variant === 'menu',
      [styles.sizeSmall]: size === 'small',
      [styles.sizeMedium]: size === 'medium',
      [styles.sizeLarge]: size === 'large',
      // css-modules-allow-undefined: horizontal is the default orientation, so it has no styles
      [styles.orientationHorizontal]: orientation === 'horizontal',
      [styles.orientationVertical]: orientation === 'vertical',
    }
  );
}

// Shared content component
const ButtonContent: React.FC<Pick<ButtonBaseProps, 'iconLeft' | 'iconRight' | 'label'>> = ({
  iconLeft,
  iconRight,
  label,
}) => (
  <>
    {iconLeft && <div className={styles.leftIcon}>{iconLeft}</div>}
    {label && <span>{label}</span>}
    {iconRight && <div className={styles.rightIcon}>{iconRight}</div>}
  </>
);

// Standard Button component (wraps <button>)
type ButtonProps = ButtonBaseProps & {
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      active = DEFAULT_BUTTON_PROPS.active,
      className,
      disabled,
      iconLeft,
      iconRight,
      label,
      orientation = DEFAULT_BUTTON_PROPS.orientation,
      themeMode,
      size = DEFAULT_BUTTON_PROPS.size,
      variant = DEFAULT_BUTTON_PROPS.variant,
      type = 'button',
      onClick,
      ...props
    },
    forwardedRef
  ) => {
    return (
      <button
        className={getButtonClassNames({
          className,
          themeMode,
          active,
          variant,
          size,
          orientation,
        })}
        disabled={disabled}
        onClick={onClick}
        type={type}
        ref={forwardedRef}
        {...props}
      >
        <ButtonContent iconLeft={iconLeft} iconRight={iconRight} label={label} />
      </button>
    );
  }
);

Button.displayName = 'Button';

// ButtonLink component (wraps React Router Link)
type ButtonLinkProps = ButtonBaseProps &
  Omit<React.ComponentProps<typeof Link>, 'className' | 'to'> & {
    to: React.ComponentProps<typeof Link>['to'];
  };

export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  (
    {
      active = DEFAULT_BUTTON_PROPS.active,
      className,
      iconLeft,
      iconRight,
      label,
      orientation = DEFAULT_BUTTON_PROPS.orientation,
      themeMode,
      size = DEFAULT_BUTTON_PROPS.size,
      variant = DEFAULT_BUTTON_PROPS.variant,
      to,
      ...props
    },
    forwardedRef
  ) => {
    return (
      <Link
        to={to}
        className={getButtonClassNames({
          className,
          themeMode,
          active,
          variant,
          size,
          orientation,
        })}
        ref={forwardedRef}
        {...props}
      >
        <ButtonContent iconLeft={iconLeft} iconRight={iconRight} label={label} />
      </Link>
    );
  }
);

ButtonLink.displayName = 'ButtonLink';

export default Button;
