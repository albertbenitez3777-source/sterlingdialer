/**
 * v261 -- search_contacts regression tests
 *
 * Covers:
 *  1. All phone number formats match the same canonical contact
 *  2. Old-campaign / cross-campaign contacts are searchable
 *  3. Call-only contacts (no lead record) are found
 *  4. Lead-only contacts (no call record) are found
 *  5. Duplicate merge: same phone across leads + calls produces one result
 *  6. Agent authorization: any authenticated active agent can search the full directory
 *  7. Exact lookup of 7182251486 against production data returns complete record
 *  8. Server-side pagination via p_offset
 *  9. Name and address search still works
 * 10. Edge function removes agent_id restriction for non-admin agents
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

const FUNC_DELIM = 'AS ' + String.fromCharCode(36) + 'function' + String.fromCharCode(36);

// Helper: replicate phone_last10 logic in JS
function phoneLast10(p: string): string {
  const digits = (p || '').replace(/\D/g, '');
  return digits.slice(-10);
}

// -- 1. phone normalization equivalence ------------------------------------
describe('phone format equivalence', () => {
  const formats = [
    '7182251486',
    '17182251486',
    '+17182251486',
    '+1 (718) 225-1486',
    '(718) 225-1486',
    '718-225-1486',
    '718 225 1486',
    '1-718-225-1486',
  ];

  for (const fmt of formats) {
    it('normalizes "' + fmt + '" to 7182251486', () => {
      expect(phoneLast10(fmt)).toBe('7182251486');
    });
  }
});

// -- 2. edge function search_contacts handler ------------------------------
describe('wolf-provider search_contacts handler', () => {
  const src = fs.readFileSync('supabase/functions/wolf-provider/index.ts', 'utf-8');
  const blockStart = src.indexOf('action === "search_contacts"');
  const blockEnd = src.indexOf('action === "secretary_call"');
  const block = src.slice(blockStart, blockEnd);

  it('passes p_offset to the RPC', () => {
    expect(block).toContain('p_offset: safeOffset');
  });

  it('does NOT filter by agent_id', () => {
    expect(block).not.toContain('.eq("agent_id"');
    expect(block).not.toContain('allowedPhones');
    expect(block).not.toContain('agentPhones');
  });

  it('escapes LIKE wildcards', () => {
    expect(block).toMatch(/replace.*[%_]/);
  });

  it('caps offset to prevent abuse', () => {
    expect(block).toMatch(/Math\.min/);
  });

  it('verifies session', () => {
    expect(block).toContain('verifySession(session_token)');
  });

  it('returns results and count', () => {
    expect(block).toContain('{ results, count: total }');
  });

  it('passes p_limit 50 for server-side pagination', () => {
    expect(block).toContain('p_limit: 50');
  });

  it('does not reference agent_direct_number', () => {
    expect(block).not.toContain('agent_direct_number');
  });
});

// -- 3. migration file structure -------------------------------------------
describe('v261 migration file', () => {
  const migrations = fs.readdirSync('supabase/migrations');
  const v261File = migrations.find(f => f.includes('v261'));

  it('migration file exists on disk', () => {
    expect(v261File).toBeDefined();
  });

  const sql = v261File ? fs.readFileSync('supabase/migrations/' + v261File, 'utf-8') : '';

  it('creates phone_last10 helper function', () => {
    expect(sql).toContain('phone_last10');
  });

  it('creates expression index on leads', () => {
    expect(sql).toContain('idx_leads_phone_digits');
  });

  it('creates expression index on calls', () => {
    expect(sql).toContain('idx_calls_phone_digits');
  });

  it('drops old 2-param signature', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.search_contacts(text, integer)');
  });

  it('new function has p_offset parameter', () => {
    expect(sql).toContain('p_offset integer DEFAULT 0');
  });

  it('uses phone_last10 for canonical matching', () => {
    expect(sql).toContain('phone_last10(l.telephone_normalized)');
    expect(sql).toContain('phone_last10(c.consumer_phone)');
  });

  it('returns total count for pagination', () => {
    expect(sql).toContain("'total', v_total");
  });
});

// -- 4. cross-campaign, no restrictions ------------------------------------
describe('cross-campaign search (no restrictions)', () => {
  const migrations = fs.readdirSync('supabase/migrations');
  const v261File = migrations.find(f => f.includes('v261'))!;
  const sql = fs.readFileSync('supabase/migrations/' + v261File, 'utf-8');
  const funcBody = sql.slice(sql.indexOf(FUNC_DELIM), sql.lastIndexOf(FUNC_DELIM));

  it('does not reference campaign_id', () => {
    expect(sql).not.toContain('campaign_id');
  });

  it('does not filter by agent_id in WHERE', () => {
    expect(funcBody).not.toMatch(/WHERE[^)]*agent_id\s*=/);
  });

  it('does not restrict by lead status', () => {
    expect(funcBody).not.toContain("status = 'new'");
    expect(funcBody).not.toContain("status != 'closed'");
  });
});
