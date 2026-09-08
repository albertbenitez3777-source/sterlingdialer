/**
 * v279 — Call evidence predicate tests.
 *
 * Imports actual production functions from _shared/call-evidence.ts.
 * Tests: representative speech, MERGED state (nested + flat), bridge evidence,
 * caller-only speech, failure/conflict, no-answer, voicemail, transfer states,
 * queue classification, drop reasons, HMAC signatures.
 */
import { describe, it, expect } from 'vitest';

// We import from the Deno edge function source — vitest resolves .ts natively
import {
  hasRepresentativeSpeech, extractRepFirstSpeechAt, hasMergedState,
  isBridgeConfirmed, detectLiveHuman, isOriginalVoicemail,
  evaluateTransferState, classifyQueue, classifyDropReason,
  flattenTranscript, blandDurationToSeconds, verifyWebhookHmac,
} from '../supabase/functions/_shared/call-evidence';

// ── hasRepresentativeSpeech ─────────────────────────────────────────
describe('hasRepresentativeSpeech', () => {
  it('true when speaker_label is representative with text', () => {
    expect(hasRepresentativeSpeech([
      { speaker_label: 'representative', text: 'Hello, how can I help?' },
    ])).toBe(true);
  });

  it('true when speaker is 2 (number) with text', () => {
    expect(hasRepresentativeSpeech([
      { speaker: 2, text: 'This is the agent speaking.' },
    ])).toBe(true);
  });

  it('true when speaker is "2" (string) with text', () => {
    expect(hasRepresentativeSpeech([
      { speaker: '2', text: 'Agent here.' },
    ])).toBe(true);
  });

  it('false when representative has empty text', () => {
    expect(hasRepresentativeSpeech([
      { speaker_label: 'representative', text: '' },
      { speaker_label: 'representative', text: '   ' },
    ])).toBe(false);
  });

  it('false for caller-only speech (speaker 1)', () => {
    expect(hasRepresentativeSpeech([
      { speaker: 1, speaker_label: 'caller', text: 'I need help with my account.' },
      { speaker: 1, text: 'Hello?' },
    ])).toBe(false);
  });

  it('false for assistant-only speech', () => {
    expect(hasRepresentativeSpeech([
      { speaker_label: 'assistant', text: 'Connecting you now...' },
    ])).toBe(false);
  });

  it('false for null/undefined/empty', () => {
    expect(hasRepresentativeSpeech(null)).toBe(false);
    expect(hasRepresentativeSpeech(undefined)).toBe(false);
    expect(hasRepresentativeSpeech([])).toBe(false);
  });

  it('false for unstructured string (cannot confirm representative)', () => {
    expect(hasRepresentativeSpeech('Representative: Hello there')).toBe(false);
  });

  it('true in mixed turns with one representative', () => {
    expect(hasRepresentativeSpeech([
      { speaker: 1, text: 'Hello?' },
      { speaker_label: 'assistant', text: 'Transferring...' },
      { speaker_label: 'representative', text: 'Hi, this is Mark.' },
    ])).toBe(true);
  });
});

// ── hasMergedState ──────────────────────────────────────────────────
describe('hasMergedState', () => {
  it('true for nested warm_transfer_call.state = MERGED', () => {
    expect(hasMergedState({ warm_transfer_call: { state: 'MERGED' } })).toBe(true);
  });

  it('true for nested warm_transfer_call.state = merged (case insensitive)', () => {
    expect(hasMergedState({ warm_transfer_call: { state: 'merged' } })).toBe(true);
  });

  it('true for flat warm_transfer_state = MERGED', () => {
    expect(hasMergedState({ warm_transfer_state: 'MERGED' })).toBe(true);
  });

  it('true for flat transfer_state = MERGED', () => {
    expect(hasMergedState({ transfer_state: 'MERGED' })).toBe(true);
  });

  it('false for RINGING state', () => {
    expect(hasMergedState({ warm_transfer_call: { state: 'RINGING' } })).toBe(false);
  });

  it('false for empty body', () => {
    expect(hasMergedState({})).toBe(false);
  });

  it('false for null warm_transfer_call', () => {
    expect(hasMergedState({ warm_transfer_call: null })).toBe(false);
  });
});

// ── isBridgeConfirmed ───────────────────────────────────────────────
describe('isBridgeConfirmed', () => {
  it('true with representative speech', () => {
    expect(isBridgeConfirmed({
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hello' }],
    })).toBe(true);
  });

  it('true with MERGED state and no transcript', () => {
    expect(isBridgeConfirmed({
      warm_transfer_call: { state: 'MERGED' },
    })).toBe(true);
  });

  it('false with caller-only post_transfer_transcript', () => {
    expect(isBridgeConfirmed({
      post_transfer_transcript: [{ speaker: 1, text: 'Hello? Anyone there?' }],
    })).toBe(false);
  });

  it('false with transferred_to only (not proof of bridge)', () => {
    expect(isBridgeConfirmed({
      transferred_to: '+15551234567',
      transferred_at: '2026-09-04T12:00:00Z',
    })).toBe(false);
  });

  it('false with transfer_status=completed (not proof of bridge)', () => {
    expect(isBridgeConfirmed({
      transfer_status: 'completed',
    })).toBe(false);
  });
});

// ── evaluateTransferState ───────────────────────────────────────────
describe('evaluateTransferState', () => {
  it('returns bridge_confirmed for representative speech', () => {
    expect(evaluateTransferState({
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hi' }],
    })).toBe('bridge_confirmed');
  });

  it('returns bridge_confirmed for nested MERGED', () => {
    expect(evaluateTransferState({
      warm_transfer_call: { state: 'MERGED' },
    })).toBe('bridge_confirmed');
  });

  it('returns transfer_failed for unsuccessful status', () => {
    expect(evaluateTransferState({ transfer_status: 'unsuccessful' })).toBe('transfer_failed');
  });

  it('returns transfer_failed for failed transfer object', () => {
    expect(evaluateTransferState({ transfer: { status: 'failed' } })).toBe('transfer_failed');
  });

  it('returns destination_ringing for transferred_to', () => {
    expect(evaluateTransferState({ transferred_to: '+15551234567' })).toBe('destination_ringing');
  });

  it('returns destination_ringing for transfer_status=completed (not bridge proof)', () => {
    expect(evaluateTransferState({ transfer_status: 'completed' })).toBe('destination_ringing');
  });

  it('returns transfer_api_accepted for requested', () => {
    expect(evaluateTransferState({ transfer_status: 'requested' })).toBe('transfer_api_accepted');
  });

  it('returns none for empty body', () => {
    expect(evaluateTransferState({})).toBe('none');
  });

  it('returns transfer_api_accepted for transcript containing "connecting you now"', () => {
    expect(evaluateTransferState({
      concatenated_transcript: 'ASSISTANT: Connecting you now to a representative.',
    })).toBe('transfer_api_accepted');
  });

  it('handles repeated/out-of-order events: failure takes precedence over ringing', () => {
    expect(evaluateTransferState({
      transfer_status: 'failed',
      transferred_to: '+15551234567',
    })).toBe('transfer_failed');
  });

  it('handles conflicting evidence: bridge speech overrides transferred_to alone', () => {
    expect(evaluateTransferState({
      transferred_to: '+15551234567',
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hi there' }],
    })).toBe('bridge_confirmed');
  });
});

// ── detectLiveHuman ─────────────────────────────────────────────────
describe('detectLiveHuman', () => {
  it('true for answered_by=human', () => {
    expect(detectLiveHuman({ answered_by: 'human' })).toBe(true);
  });

  it('false for answered_by=voicemail', () => {
    expect(detectLiveHuman({ answered_by: 'voicemail' })).toBe(false);
  });

  it('true for inbound calls', () => {
    expect(detectLiveHuman({ direction: 'inbound' })).toBe(true);
  });

  it('false for voicemail transcript', () => {
    expect(detectLiveHuman({}, 'USER: leave a message after the tone')).toBe(false);
  });

  it('true for substantive user reply in transcript', () => {
    expect(detectLiveHuman({}, 'USER: Yes I am interested in learning more about this')).toBe(true);
  });
});

// ── isOriginalVoicemail ─────────────────────────────────────────────
describe('isOriginalVoicemail', () => {
  it('true for voicemail flag', () => {
    expect(isOriginalVoicemail({ voicemail: true }, '')).toBe(true);
  });

  it('true for answered_by=machine', () => {
    expect(isOriginalVoicemail({ answered_by: 'machine' }, '')).toBe(true);
  });

  it('true for transcript with "leave a message"', () => {
    expect(isOriginalVoicemail({}, 'Please leave a message after the tone')).toBe(true);
  });

  it('false for live human transcript', () => {
    expect(isOriginalVoicemail({}, 'Hello, who is this?')).toBe(false);
  });
});

// ── classifyQueue ───────────────────────────────────────────────────
describe('classifyQueue', () => {
  it('fire_transfer for bridge_confirmed', () => {
    expect(classifyQueue('bridge_confirmed', true, false, false)).toBe('fire_transfer');
  });

  it('voice_message for bridge_confirmed with voicemail marker', () => {
    expect(classifyQueue('bridge_confirmed', true, false, true)).toBe('voice_message');
  });

  it('human_drop for transfer_failed', () => {
    expect(classifyQueue('transfer_failed', true, false, false)).toBe('human_drop');
  });

  it('voice_message for voicemail with no live human', () => {
    expect(classifyQueue('none', false, true, false)).toBe('voice_message');
  });

  it('human_drop for live human without bridge', () => {
    expect(classifyQueue('none', true, false, false)).toBe('human_drop');
  });

  it('no_answer for nothing', () => {
    expect(classifyQueue('none', false, false, false)).toBe('no_answer');
  });
});

// ── classifyDropReason ──────────────────────────────────────────────
describe('classifyDropReason', () => {
  it('dnc for do-not-call markers', () => {
    expect(classifyDropReason({ is_dnc: true }, 'none', 'no_answer', '')).toBe('dnc');
  });

  it('voicemail for answered_by=voicemail', () => {
    expect(classifyDropReason({ answered_by: 'voicemail' }, 'none', 'voice_message', '')).toBe('voicemail');
  });

  it('transfer_no_answer for timed-out transfer', () => {
    expect(classifyDropReason({ transfer_failure_reason: 'timed out waiting' }, 'transfer_failed', 'human_drop', '')).toBe('transfer_no_answer');
  });

  it('bridge_confirmed for bridge with rep speech', () => {
    expect(classifyDropReason({
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hi' }],
    }, 'bridge_confirmed', 'fire_transfer', '')).toBe('bridge_confirmed');
  });

  it('no_answer for no-answer status', () => {
    expect(classifyDropReason({ status: 'no_answer' }, 'none', 'no_answer', '')).toBe('no_answer');
  });
});

// ── flattenTranscript ───────────────────────────────────────────────
describe('flattenTranscript', () => {
  it('prefers concatenated when present', () => {
    expect(flattenTranscript([{ text: 'raw' }], 'concatenated')).toBe('concatenated');
  });

  it('flattens array', () => {
    const result = flattenTranscript([
      { role: 'assistant', text: 'Hello' },
      { role: 'user', text: 'Hi' },
    ]);
    expect(result).toContain('ASSISTANT: Hello');
    expect(result).toContain('USER: Hi');
  });

  it('returns empty for null', () => {
    expect(flattenTranscript(null)).toBe('');
  });
});

// ── blandDurationToSeconds ──────────────────────────────────────────
describe('blandDurationToSeconds', () => {
  it('converts minutes to seconds', () => {
    expect(blandDurationToSeconds(2.5)).toBe(150);
  });

  it('treats >100 as already seconds', () => {
    expect(blandDurationToSeconds(180)).toBe(180);
  });

  it('handles string input', () => {
    expect(blandDurationToSeconds('1.5')).toBe(90);
  });

  it('returns 0 for invalid', () => {
    expect(blandDurationToSeconds(null)).toBe(0);
    expect(blandDurationToSeconds(-1)).toBe(0);
  });
});

// ── verifyWebhookHmac ──────────────────────────────────────────────
describe('verifyWebhookHmac', () => {
  // Simple mock createHmac for testing
  const mockCreateHmac = (algo: string, key: string) => ({
    update(data: string) {
      return {
        digest(_enc: string): string {
          // Deterministic hash mock: just concat algo+key+data and hex-encode
          const combined = `${algo}:${key}:${data}`;
          return Array.from(new TextEncoder().encode(combined))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        },
      };
    },
  });

  function computeMockSig(body: string, secret: string): string {
    return mockCreateHmac('sha256', secret).update(body).digest('hex');
  }

  it('rejects when secret is missing', () => {
    const result = verifyWebhookHmac('body', 'sig', null, mockCreateHmac);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not configured');
  });

  it('rejects when signature header is missing', () => {
    const result = verifyWebhookHmac('body', null, 'secret', mockCreateHmac);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing signature');
  });

  it('accepts valid signature', () => {
    const body = '{"call_id":"abc"}';
    const secret = 'test-secret';
    const sig = computeMockSig(body, secret);
    const result = verifyWebhookHmac(body, sig, secret, mockCreateHmac);
    expect(result.valid).toBe(true);
  });

  it('accepts valid signature with sha256= prefix', () => {
    const body = '{"call_id":"abc"}';
    const secret = 'test-secret';
    const sig = 'sha256=' + computeMockSig(body, secret);
    const result = verifyWebhookHmac(body, sig, secret, mockCreateHmac);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid signature', () => {
    const result = verifyWebhookHmac('body', 'bad-sig', 'secret', mockCreateHmac);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('rejects tampered body', () => {
    const secret = 'test-secret';
    const sig = computeMockSig('original-body', secret);
    const result = verifyWebhookHmac('tampered-body', sig, secret, mockCreateHmac);
    expect(result.valid).toBe(false);
  });
});

// ── extractRepFirstSpeechAt ─────────────────────────────────────────
describe('extractRepFirstSpeechAt', () => {
  it('returns timestamp of first representative turn', () => {
    const result = extractRepFirstSpeechAt([
      { speaker: 1, text: 'Hello?', timestamp: '2026-09-04T12:00:00Z' },
      { speaker_label: 'representative', text: 'Hi there', timestamp: '2026-09-04T12:00:05Z' },
    ]);
    expect(result).toBe('2026-09-04T12:00:05Z');
  });

  it('returns null for no representative speech', () => {
    expect(extractRepFirstSpeechAt([
      { speaker: 1, text: 'Hello?' },
    ])).toBe(null);
  });

  it('returns null for non-array', () => {
    expect(extractRepFirstSpeechAt('some string')).toBe(null);
    expect(extractRepFirstSpeechAt(null)).toBe(null);
  });
});
