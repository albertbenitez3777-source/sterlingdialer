import { useRef, useEffect, useState, type ReactNode } from 'react';
import { GlassCard } from './GlassCard';

type StatCardProps = {
  label: string;
  value: number;
  icon?: ReactNode;
  accent?: 'gold' | 'green' | 'red' | 'amber' | 'steel';
  delay?: number;
  suffix?: string;
  children?: ReactNode;
};

/**
 * GlassCard + animated count-up number + colored accent line/glow per metric.
 */
export function StatCard({ label, value, icon, accent = 'steel', delay = 0, suffix = '', children }: StatCardProps) {
  const display = useCountUp(value, 900, delay);
  return (
    <GlassCard accent={accent} hoverLift glow className="stat-card-premium" style={{ animationDelay: `${delay}ms` }}>
      {icon && <div className="stat-card-premium-icon">{icon}</div>}
      <span className="stat-card-premium-label">{label}</span>
      <span className="stat-card-premium-value">
        {display}{suffix}
      </span>
      {children}
    </GlassCard>
  );
}

/** RAF-based count-up with ease-out-cubic. */
function useCountUp(target: number, duration = 800, delay = 0): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const startTimer = setTimeout(() => {
      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setVal(Math.round(target * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(animate);
      };
      rafRef.current = requestAnimationFrame(animate);
    }, delay);
    return () => { clearTimeout(startTimer); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, delay]);

  return val;
}
