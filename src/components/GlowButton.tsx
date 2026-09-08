import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from 'react';

type GlowButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** Visual variant */
  variant?: 'gold' | 'sage' | 'rust' | 'steel' | 'ghost';
  /** Stretch to full width */
  fullWidth?: boolean;
};

const variantClass: Record<string, string> = {
  gold: 'glow-button-gold',
  sage: 'glow-button-sage',
  rust: 'glow-button-rust',
  steel: 'glow-button-steel',
  ghost: 'glow-button-ghost',
};

export const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ children, className = '', variant = 'gold', fullWidth = false, disabled, ...rest }, ref) => {
    const classes = [
      'glow-button',
      variantClass[variant],
      fullWidth && 'glow-button-full-width',
      disabled && 'glow-button-disabled',
      className,
    ].filter(Boolean).join(' ');
    return (
      <button ref={ref} className={classes} disabled={disabled} {...rest}>
        {children}
      </button>
    );
  }
);

GlowButton.displayName = 'GlowButton';
