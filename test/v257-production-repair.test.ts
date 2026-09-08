import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname || __dirname, '..');

describe('v257 Production Repair', () => {
  // ── 1. Opportunity callback uses React state, not DOM mutation ──
  const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
  it('No document.querySelector in App.tsx', () => { expect(!APP.includes('document.querySelector')).toBe(true); });
  it('Callback sets secClientName via state', () => { expect(APP.includes('setSecClientName(name)')).toBe(true); });
  it('Callback sets secClientPhone via state', () => { expect(APP.includes('setSecClientPhone(phone)')).toBe(true); });

  // ── 2. RecordingPlayer: useEffect recovery, manual Retry ──
  const RP = readFileSync(join(ROOT, 'src', 'components', 'RecordingPlayer.tsx'), 'utf-8');
  it('Recovery runs in useEffect', () => { expect(RP.includes('useEffect')).toBe(true); });
  it('Manual retry handler exists', () => { expect(RP.includes('handleManualRetry')).toBe(true); });
  it('Retry button rendered', () => { expect(RP.includes('recording-retry-btn')).toBe(true); });
  it('Recovery wrapped in try/finally', () => { expect(RP.includes('try {') && RP.includes('finally {')).toBe(true); });

  // ── 3. OpportunitiesFeed: try/finally + retry button ──
  const OF = readFileSync(join(ROOT, 'src', 'components', 'OpportunitiesFeed.tsx'), 'utf-8');
  it('fetchOpportunities has finally block', () => { expect(OF.includes('} finally {')).toBe(true); });
  it('Error state has Retry button', () => { expect(OF.includes('opp-retry-btn')).toBe(true); });
  it('Catches network errors', () => { expect(OF.includes("Network error")).toBe(true); });

  // ── 4. AgentCockpit types ──
  const AC = readFileSync(join(ROOT, 'src', 'components', 'AgentCockpit.tsx'), 'utf-8');
  it('AgentTodayStats has live_humans', () => { expect(AC.includes('live_humans?: number')).toBe(true); });
  it('AgentTodayStats has active_calls_now', () => { expect(AC.includes('active_calls_now?: number')).toBe(true); });
  it('AgentTodayStats has today_total', () => { expect(AC.includes('today_total?: number')).toBe(true); });

  // ── 5. App.tsx handler hardening ──
  it('toggleAgent checks response body', () => { expect(APP.includes('if (!data.success) { setNotice(data.error')).toBe(true); });
  it('handleDeleteSavedTransfer has loading guard', () => { expect(APP.includes('deletingSavedId')).toBe(true); });
  it('handleUploadLeads has double-submit guard', () => { expect(APP.includes('if (importing) return')).toBe(true); });

  // ── 6. AI script compliance ──
  const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
  it('No more "personal business matter" in scripts', () => { expect(!PROVIDER.includes('regarding a personal business matter')).toBe(true); });
  it('Scripts identify Sterling Collections', () => { expect(PROVIDER.includes('Sterling Collections')).toBe(true); });
  it('Scripts use compliant "private account matter"', () => { expect(PROVIDER.includes('private account matter')).toBe(true); });
  it('5-second wait timeout in scripts', () => { expect(PROVIDER.includes('WAIT up to 5 seconds')).toBe(true); });
  it('Truthful AI disclosure when asked', () => { expect(PROVIDER.includes('automated assistant')).toBe(true); });
  it('All 5 script copies updated to Sterling Collections', () => {
    const scriptMatches = PROVIDER.match(/Sterling Collections/g);
    expect(scriptMatches !== null && scriptMatches.length >= 5).toBe(true);
  });

  // ── 7. Backfill detectLiveHuman tightened ──
  const BACKFILL = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-backfill', 'index.ts'), 'utf-8');
  it('No permissive "hello" heuristic in backfill', () => { expect(!BACKFILL.includes('if (t.includes("hello")')).toBe(true); });
  it('No permissive "yes" heuristic in backfill', () => { expect(!BACKFILL.includes('if (t.includes("yes")')).toBe(true); });
  it('Uses substantive reply check', () => {
    const EVIDENCE = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'call-evidence.ts'), 'utf-8');
    expect(EVIDENCE.includes('detectLiveHuman') && EVIDENCE.includes('.length > 2')).toBe(true);
  });

  // ── 8. Webhook bridge detection strict ──
  const WEBHOOK = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-webhook', 'index.ts'), 'utf-8');
  it('Requires representative speaker label', () => {
    const EVIDENCE = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'call-evidence.ts'), 'utf-8');
    expect(EVIDENCE.includes('speakerLabel === "representative"')).toBe(true);
  });
  it('Allows numeric speaker 2', () => {
    const EVIDENCE = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'call-evidence.ts'), 'utf-8');
    expect(EVIDENCE.includes('speaker === 2 || speaker === "2"')).toBe(true);
  });
  it('No permissive assistant fallback in bridge detection', () => { expect(!WEBHOOK.includes('"assistant"') || WEBHOOK.indexOf('"assistant"') > WEBHOOK.indexOf('hasRepresentativeSpeech')).toBe(true); });
  it('Explicit comment blocking permissive status', () => { expect(WEBHOOK.includes('Do NOT set queue=\'fire_transfer\'')).toBe(true); });

  // ── 9. Color update ──
  const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
  it('Recording retry button styled', () => { expect(CSS.includes('recording-retry-btn')).toBe(true); });
  it('Opportunity retry button styled', () => { expect(CSS.includes('opp-retry-btn')).toBe(true); });

  // ── 10. No agent_direct_number in transfer routing ──
  it('agent_direct_number never used as transfer destination', () => { expect(!PROVIDER.includes('transfer_phone_number: normalizeToE164(agentRow.agent_direct_number)')).toBe(true); });
  it('Transfers use talkroute_number', () => { expect(PROVIDER.includes('talkroute_number')).toBe(true); });
});
