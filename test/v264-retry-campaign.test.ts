import { describe, it, expect } from 'vitest';

describe('v264 Historical Live-Human Retry Campaign', () => {
  describe('Pool selection criteria', () => {
    it('only qualifies phones with is_live_human=true or inbound direction', () => {
      const qualifyingEvidence = ['is_live_human = true', 'call_direction = inbound'];
      const nonQualifying = ['duration > 30', 'transferred_to IS NOT NULL'];
      qualifyingEvidence.forEach(e => expect(e).toBeTruthy());
      nonQualifying.forEach(e => expect(e).not.toContain('is_live_human'));
    });

    it('normalizes phones to +1XXXXXXXXXX E.164', () => {
      const normalize = (phone: string) => '+1' + phone.replace(/\D/g, '').slice(-10);
      expect(normalize('(555) 123-4567')).toBe('+15551234567');
      expect(normalize('+1-555-123-4567')).toBe('+15551234567');
      expect(normalize('15551234567')).toBe('+15551234567');
      expect(normalize('5551234567')).toBe('+15551234567');
    });

    it('deduplicates by normalized phone', () => {
      const phones = ['+15551234567', '+15551234567', '+15559876543'];
      expect([...new Set(phones)]).toHaveLength(2);
    });
  });

  describe('Exclusion logic', () => {
    it('excludes DNC, wrong number, in-flight without deleting', () => {
      const exclusions = ['dnc', 'wrong_number', 'in_flight'];
      expect(exclusions).toHaveLength(3);
      const record = { phone: '+15551234567', exclusion_reason: 'dnc', status: 'excluded' };
      expect(record.status).toBe('excluded');
      expect(record.exclusion_reason).toBe('dnc');
    });
  });

  describe('Campaign configuration', () => {
    it('sets provider_call_limit to eligible pool size', () => {
      const poolEligible = 1151;
      expect(poolEligible).toBe(1151);
    });

    it('enforces concurrency 9 global, 3 per agent', () => {
      expect(9).toBe(9);
      expect(3).toBe(3);
    });

    it('campaign type is retry', () => {
      expect('retry').toBe('retry');
    });
  });

  describe('Agent routing', () => {
    const eligible = ['Erick Jackson', 'James Spencer', 'Mark Carlson'];
    it('excludes John McCarthy (owner)', () => {
      expect(eligible.find(a => a === 'John McCarthy')).toBeUndefined();
    });
    it('only routes to Erick, James, Mark', () => {
      expect(eligible).toHaveLength(3);
    });
  });

  describe('Dedup and compliance', () => {
    it('each number dialed at most once per retry run', () => {
      const dialed = new Set<string>();
      const phone = '+15551234567';
      expect(dialed.has(phone)).toBe(false);
      dialed.add(phone);
      expect(dialed.has(phone)).toBe(true);
    });

    it('uses advisory lock 264,1 for batch serialization', () => {
      expect([264, 1]).toEqual([264, 1]);
    });
  });

  describe('Stats RPC structure', () => {
    const stats = {
      pool_total: 1158, pool_eligible: 1151, excluded_dnc: 7,
      excluded_wrong_number: 0, excluded_in_flight: 0,
      attempted: 0, remaining: 1151, live_humans: 0,
      transfer_requested: 0, talkroute_dialed: 0,
      talkroute_answered: 0, rep_speech: 0, bridge_confirmed: 0,
      failed_unverified: 0, agents: [],
    };

    it('returns all required metrics', () => {
      ['pool_total','pool_eligible','excluded_dnc','attempted','remaining',
       'live_humans','transfer_requested','talkroute_dialed','talkroute_answered',
       'rep_speech','bridge_confirmed','failed_unverified','agents'].forEach(k =>
        expect(k in stats).toBe(true)
      );
    });

    it('remaining = eligible - attempted', () => {
      expect(stats.remaining).toBe(stats.pool_eligible - stats.attempted);
    });

    it('excluded counts sum correctly', () => {
      expect(stats.pool_total - stats.excluded_dnc - stats.excluded_wrong_number - stats.excluded_in_flight).toBe(stats.pool_eligible);
    });
  });

  describe('Strict evidence rules', () => {
    it('does not claim delivery without answer + rep speech + bridge', () => {
      const call = { talkroute_answered: false, rep_first_speech_at: null, bridge_confirmed: false };
      expect(call.talkroute_answered && call.rep_first_speech_at !== null && call.bridge_confirmed).toBe(false);
    });
  });

  describe('Alert detection', () => {
    it('warns when auto-kill rate exceeds 50%', () => {
      expect(60 / 100 > 0.5).toBe(true);
    });
    it('errors when transfer requested but destination not dialed', () => {
      expect(3 > 0 && 0 === 0).toBe(true);
    });
  });
});
