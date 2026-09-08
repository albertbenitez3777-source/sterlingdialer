import { forwardRef, type ReactNode, type HTMLAttributes } from 'react';

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Hover lift + gold glow on mouse over */
  hoverLift?: boolean;
  /** Extra glow intensity (for stat cards, active items) */
  glow?: boolean;
  /** Accent color for top border line — auto from theme or custom hex */
  accent?: 'gold' | 'green' | 'red' | 'amber' | 'steel' | 'none';
};

const accentMap: Record<string, string> = {
  gold: 'glass-card-accent-gold',
  green: 'glass-card-accent-green',
  red: 'glass-card-accent-red',
  amber: 'glass-card-accent-amber',
  steel: 'glass-card-accent-steel',
  none: '',
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className = '', hoverLift = false, glow = false, accent = 'none', ...rest }, ref) => {
    const classes = [
      'glass-card',
      hoverLift && 'glass-card-hover-lift',
      glow && 'glass-card-glow',
      accentMap[accent],
      className,
    ].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={classes} {...rest}>
        {children}
      </div>
    );
  }
);

GlassCard.displayName = 'GlassCard';
