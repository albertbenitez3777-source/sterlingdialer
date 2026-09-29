// Global automated-dialer ceiling; agent phone capacity is configured separately.
export const MAX_DIALER_LINES = 25;
export const DIALER_LINE_PRESETS = [3, 6, 9, 12, 16, 20, 25] as const;

export function isValidDialerLines(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DIALER_LINES;
}
