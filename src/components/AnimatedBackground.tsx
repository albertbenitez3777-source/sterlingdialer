import { memo } from 'react';

/**
 * Slow drifting aurora mesh gradient + faint film grain + radial vignette.
 * GPU-friendly (transform/opacity only), honors prefers-reduced-motion.
 * Sits behind dark areas so nothing reads as flat black.
 */
function AnimatedBackgroundImpl() {
  return (
    <div className="animated-bg" aria-hidden="true">
      <div className="animated-bg-aurora animated-bg-aurora-gold" />
      <div className="animated-bg-aurora animated-bg-aurora-steel" />
      <div className="animated-bg-grain" />
      <div className="animated-bg-vignette" />
    </div>
  );
}

export const AnimatedBackground = memo(AnimatedBackgroundImpl);
