import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

type RevealProps = {
  children: ReactNode;
  delay?: number;
  y?: number;
  scale?: number;
  once?: boolean;
  className?: string;
};

/**
 * Staggered fade/slide/scale-in on mount. Transform/opacity only (60fps).
 * Honors prefers-reduced-motion — falls back to simple fade.
 */
export function Reveal({ children, delay = 0, y = 14, scale = 1, once = true, className = '' }: RevealProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y, scale: scale < 1 ? scale : undefined }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      viewport={once ? { once: true } : undefined}
    >
      {children}
    </motion.div>
  );
}

type RevealStaggerProps = {
  children: ReactNode;
  delay?: number;
  stagger?: number;
  className?: string;
};

/** Container that staggers its children's reveal. */
export function RevealStagger({ children, delay = 0, stagger = 0.08, className = '' }: RevealStaggerProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduced ? 0 : stagger, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Child item for use inside <RevealStagger>. */
export function RevealItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 14 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
      }}
    >
      {children}
    </motion.div>
  );
}
