import type { ReactNode } from 'react';

export type PillVariant = 'pending' | 'no_answer' | 'human_drop' | 'fire_transfer' | 'voice_message' | 'completed' | 'live' | 'dnc';

type StatusPillProps = {
  variant: PillVariant;
  children?: ReactNode;
  pulse?: boolean;
};

const variantConfig: Record<PillVariant, { label: string; className: string; pulse: boolean }> = {
  pending:         { label: 'DIALING',    className: 'status-pill-pending',    pulse: true },
  no_answer:       { label: 'NO ANSWER',  className: 'status-pill-no-answer',  pulse: false },
  human_drop:      { label: 'DROPPED',    className: 'status-pill-dropped',    pulse: false },
  fire_transfer:   { label: 'TRANSFER',   className: 'status-pill-transfer',   pulse: true },
  voice_message:   { label: 'VOICEMAIL',  className: 'status-pill-voicemail',  pulse: false },
  completed:       { label: 'COMPLETED',  className: 'status-pill-completed',  pulse: true },
  live:            { label: 'LIVE HUMAN', className: 'status-pill-live',       pulse: true },
  dnc:             { label: 'DNC',        className: 'status-pill-dnc',        pulse: false },
};

/**
 * Glowing colored pill for call outcomes and live status.
 * Variants: DIALING pulse-blue, TRANSFER gold, VOICEMAIL amber,
 * NO ANSWER grey, DROPPED red, LIVE HUMAN green, COMPLETED green, DNC red.
 */
export function StatusPill({ variant, children, pulse }: StatusPillProps) {
  const cfg = variantConfig[variant];
  const shouldPulse = pulse ?? cfg.pulse;
  return (
    <span className={`status-pill ${cfg.className} ${shouldPulse ? 'status-pill-pulse' : ''}`}>
      {children ?? cfg.label}
    </span>
  );
}

/** Map a queue string from the database to the matching pill variant. */
export function queueToPillVariant(queue: string): PillVariant {
  const map: Record<string, PillVariant> = {
    pending: 'pending',
    no_answer: 'no_answer',
    human_drop: 'human_drop',
    fire_transfer: 'fire_transfer',
    voice_message: 'voice_message',
    completed: 'completed',
  };
  return map[queue] ?? 'no_answer';
}
