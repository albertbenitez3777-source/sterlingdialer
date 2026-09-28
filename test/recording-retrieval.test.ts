import { describe, expect, it, vi } from 'vitest';
import { operations } from '../supabase/functions/federal-one-v2/operations';

// Stub the zadarmaClient import.  operations.ts calls zadarmaClient(db) which
// reads system_config — we intercept it at the module level.
let nextZadarmaResponse: unknown = {};
let lastZadarmaParams: Record<string, string> | undefined;

vi.mock('../supabase/functions/federal-one-v2/zadarma.ts', () => ({
  zadarmaClient: async () => async (_path: string, params: Record<string, string> = {}) => {
    lastZadarmaParams = params;
    return nextZadarmaResponse;
  },
}));
vi.mock('../supabase/functions/federal-one-v2/mailbox.ts', () => ({
  voicemailReceiverConfigured: async () => true,
}));

const actor = { id: 'agent-james', role: 'agent' };

function database(overrides: Record<string, unknown> = {}) {
  const zadarmaCall = overrides.zadarmaCall ?? { pbx_call_id: 'call-123', recording_id: 'rec-abc-456' };
  const db: any = {
    from: (table: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain, not: () => chain,
        order: () => chain, limit: () => chain, is: () => chain,
        in: () => chain, gte: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === 'federal_one_zadarma_calls' ? zadarmaCall : null, error: null }),
        single: () => Promise.resolve({ data: table === 'federal_one_zadarma_calls' ? zadarmaCall : null, error: null }),
      }; return chain;
    },
    rpc: () => Promise.resolve({ data: {}, error: null }),
  };
  return db;
}

describe('phone_recording — Zadarma response shapes', () => {
  it('returns the link when Zadarma responds with singular "link" (Response 1)', async () => {
    nextZadarmaResponse = { status: 'success', link: 'https://api.zadarma.com/v1/pbx/record/download/abc123/recording.mp3', lifetime_till: '2026-10-01 00:00:00' };
    const db = database();
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(result!.status).toBe(200);
    expect(result!.data).toEqual({ url: 'https://api.zadarma.com/v1/pbx/record/download/abc123/recording.mp3' });
  });

  it('returns the first link when Zadarma responds with plural "links" array (Response 2)', async () => {
    nextZadarmaResponse = {
      status: 'success',
      links: [
        'https://api.zadarma.com/v1/pbx/record/download/abc123/segment1.mp3',
        'https://api.zadarma.com/v1/pbx/record/download/def456/segment2.mp3',
      ],
      lifetime_till: '2026-10-01 00:00:00',
    };
    const db = database();
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(result!.status).toBe(200);
    expect(result!.data).toEqual({ url: 'https://api.zadarma.com/v1/pbx/record/download/abc123/segment1.mp3' });
  });

  it('returns 409 when neither link nor links is present (recording not ready)', async () => {
    nextZadarmaResponse = { status: 'success' };
    const db = database();
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(result!.status).toBe(409);
    expect(result!.data.error).toContain('not ready yet');
  });

  it('returns 404 when the call has no recording_id', async () => {
    const db = database({ zadarmaCall: { pbx_call_id: 'call-123', recording_id: null } });
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(result!.status).toBe(404);
    expect(result!.data.error).toContain('not supplied a recording');
  });

  it('returns 503 with retryable message when Zadarma throws', async () => {
    vi.resetModules();
    // Re-mock with a throwing function
    vi.doMock('../supabase/functions/federal-one-v2/zadarma.ts', () => ({
      zadarmaClient: async () => async () => { throw new Error('Connection refused'); },
    }));
    vi.doMock('../supabase/functions/federal-one-v2/mailbox.ts', () => ({
      voicemailReceiverConfigured: async () => true,
    }));
    const { operations: ops } = await import('../supabase/functions/federal-one-v2/operations');
    const db = database();
    const result = await ops(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(result!.status).toBe(503);
    expect(result!.data.error).toContain('temporarily unavailable');
  });

  it('passes call_id (not pbx_call_id) to Zadarma with the stored recording_id', async () => {
    nextZadarmaResponse = { status: 'success', link: 'https://api.zadarma.com/v1/pbx/record/download/x/y.mp3' };
    const db = database();
    await operations(db, actor, { action: 'phone_recording', id: 'call-123' });
    expect(lastZadarmaParams).toBeDefined();
    expect(lastZadarmaParams!.call_id).toBe('rec-abc-456');
    expect(lastZadarmaParams!.lifetime).toBe('300');
  });

  it('does not expose recording_id in the phone_activity response', async () => {
    const db = database();
    const result = await operations(db, { id: 'agent-james', role: 'agent' }, { action: 'phone_activity' });
    expect(result!.status).toBe(200);
    const calls = result!.data.calls;
    for (const call of calls) {
      expect(call).not.toHaveProperty('recording_id');
    }
  });
});

describe('phone_recording — AI call path', () => {
  it('returns the recording URL for AI calls with valid recording', async () => {
    const db: any = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain, eq: () => chain, not: () => chain,
          order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({
            data: table === 'calls' ? { recording_url: 'https://bland.ai/recording/abc.mp3' } : null,
            error: null,
          }),
        }; return chain;
      },
      rpc: () => Promise.resolve({ data: {}, error: null }),
    };
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-ai-1', kind: 'ai' });
    expect(result!.status).toBe(200);
    expect(result!.data.url).toBe('https://bland.ai/recording/abc.mp3');
  });

  it('returns 404 when AI recording has not arrived yet', async () => {
    const db: any = {
      from: () => {
        const chain: any = {
          select: () => chain, eq: () => chain, not: () => chain,
          maybeSingle: () => Promise.resolve({ data: { recording_url: null }, error: null }),
        }; return chain;
      },
      rpc: () => Promise.resolve({ data: {}, error: null }),
    };
    const result = await operations(db, actor, { action: 'phone_recording', id: 'call-ai-2', kind: 'ai' });
    expect(result!.status).toBe(404);
    expect(result!.data.error).toContain('not arrived yet');
  });
});
