// v247 — ensure_transfer_live correction: talkroute leg alone must NOT bridge
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const V245 = readFileSync(join(ROOT, 'supabase', 'migrations', '20260902173709_20260902190000_v245_consolidate_dialer_hardening.sql'), 'utf-8');
const WEBHOOK = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-webhook', 'index.ts'), 'utf-8');

const createIdx = V245.indexOf("CREATE OR REPLACE FUNCTION public.ensure_transfer_live()");
const dollar1 = V245.indexOf('$function$', createIdx) + '$function$'.length;
const dollar2 = V245.indexOf('$function$', dollar1);
const fullFnBody = V245.slice(dollar1, dollar2);
const executableLines = fullFnBody.split('\n').filter(l => !l.trim().startsWith('--') && l.trim() !== '').join('\n');
const commentLines = fullFnBody.split('\n').filter(l => l.trim().startsWith('--')).join('\n');

describe('v247 ensure_transfer_live Bridge Correction', () => {
  describe('V245 source corrected: no bridge fields in executable lines', () => {
    it('does NOT set bridge_confirmed', () => { expect(executableLines).not.toContain('bridge_confirmed'); });
    it('does NOT set bridge_confirmed_at', () => { expect(executableLines).not.toContain('bridge_confirmed_at'); });
    it('does NOT set talkroute_answered', () => { expect(executableLines).not.toContain('talkroute_answered'); });
    it('does NOT assign transfer_status', () => { expect(executableLines).not.toContain('transfer_status :='); });
    it('does NOT assign transfer_state', () => { expect(executableLines).not.toContain('transfer_state :='); });
    it('does NOT set queue=fire_transfer', () => { expect(executableLines).not.toContain("'fire_transfer'"); });
  });

  describe('is_live_human still set correctly', () => {
    it('sets is_live_human', () => { expect(executableLines).toContain('is_live_human := true'); });
    it('checks transfer phrase', () => { expect(fullFnBody).toContain('connecting you now'); });
    it('checks talkroute_leg_created', () => { expect(executableLines).toContain('talkroute_leg_created'); });
  });

  describe('Migration header corrected', () => {
    it('header says no bridge_confirmed', () => { expect(V245).toContain('MUST NOT set bridge_confirmed'); });
    it('header references V247 fix', () => { expect(V245).toContain('Fixed in V247'); });
  });

  describe('Bridge proof in webhook only', () => {
    it('webhook checks representative speech', () => { expect(WEBHOOK).toContain('representative'); });
    it('webhook checks MERGED warm-transfer state', () => { expect(WEBHOOK).toContain('MERGED'); });
    it('webhook sets bridge_confirmed', () => { expect(WEBHOOK).toContain('bridge_confirmed'); });
  });

  describe('Talkroute-leg-only remains unbridged', () => {
    it('function comment: NOT bridge proof', () => { expect(commentLines).toContain('NOT bridge proof'); });
    it('trigger section has zero bridge_confirmed assignments', () => {
      const triggerSection = V245.slice(V245.indexOf('-- 3. ensure_transfer_live'), V245.indexOf('-- 4. pg_cron'));
      expect(triggerSection).not.toContain('bridge_confirmed :=');
    });
  });

  describe('norm_xfer unchanged', () => {
    it('checks transfer_failed', () => { expect(V245).toContain("NEW.transfer_state = 'transfer_failed'"); });
    it('checks talkroute not created', () => { expect(V245).toContain('NEW.talkroute_leg_created IS NOT TRUE'); });
  });

  describe('Webhook speaker normalization', () => {
    it('webhook processes speaker labels', () => { expect(WEBHOOK.includes('speaker') || WEBHOOK.includes('hasRepresentativeSpeech')).toBe(true); });
  });
});
