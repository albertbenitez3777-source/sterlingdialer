import { memo, type ReactNode } from 'react';

type HeroImageProps = {
  src: string;
  alt?: string;
  /** Overlay text centered on the image */
  overlay?: string;
  /** Height of the hero band */
  height?: number | string;
  className?: string;
  children?: ReactNode;
  /** Add the fire/flame treatment (for call-now hero) */
  flame?: boolean;
};

/**
 * Full-bleed royalty-free image + gradient scrim + slow Ken Burns drift.
 * Lazy-loaded. Honors prefers-reduced-motion via CSS.
 */
function HeroImageImpl({ src, alt = '', overlay, height = 180, className = '', children, flame = false }: HeroImageProps) {
  return (
    <div
      className={`hero-image ${flame ? 'hero-image-flame' : ''} ${className}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <img src={src} alt={alt} loading="lazy" />
      {overlay && (
        <div className="hero-image-overlay">
          <strong>{overlay}</strong>
        </div>
      )}
      {children}
    </div>
  );
}

export const HeroImage = memo(HeroImageImpl);
