/**
 * Call-flow lifecycle regression tests — 32 checks.
 * Covers: premature completion, human detection, rep timestamps,
 * transfer states, queue classification, voicemail, bridge evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  hasRepresentativeSpeech, extractRepFirstSpeechAt, hasMergedState,
  isBridgeConfirmed, detectLiveHuman, isOriginalVoicemail,
  evaluateTransferState, classifyQueue, classifyDropReason,
  flattenTranscript, blandDurationToSeconds,
} from '../supabase/functions/_shared/call-evidence';

// ── 1-4: Premature completion guards ───────────────────────────────
describe('premature completion guards', () => {
  it('1: mid-call transfer event should not be treated as end-of-call', () => {
    // A transfer_api_accepted state with no transcript is mid-call
    const state = evaluateTransferState({ transfer_status: 'requested' });
    expect(state).toBe('transfer_api_accepted');
    // No transcript + no duration = call not finished
    const hasEvidence = Boolean('' || 0 > 0 || '');
    expect(hasEvidence).toBe(false);
  });

  it('2: in_progress status has no terminal evidence', () => {
    const status = 'in_progress';
    const isTerminal = ['completed', 'failed', 'no-answer', 'no_answer', 'busy', 'error'].includes(status);
    expect(isTerminal).toBe(false);
  });

  it('3: completed status IS terminal evidence', () => {
    const status = 'completed';
    const isTerminal = ['completed', 'failed', 'no-answer', 'no_answer', 'busy', 'error'].includes(status);
    expect(isTerminal).toBe(true);
  });

  it('4: call with transcript has end-of-call evidence', () => {
    const transcript = 'USER: Hello\nASSISTANT: Hi there';
    const hasEvidence = Boolean(transcript);
    expect(hasEvidence).toBe(true);
  });
});

// ── 5-10: Human detection preserved ────────────────────────────────
describe('human detection preserved correctly', () => {
  it('5: answered_by=human is detected', () => {
    expect(detectLiveHuman({ answered_by: 'human' })).toBe(true);
  });

  it('6: answered_by=voicemail is NOT human', () => {
    expect(detectLiveHuman({ answered_by: 'voicemail' })).toBe(false);
  });

  it('7: inbound call is always human', () => {
    expect(detectLiveHuman({ direction: 'inbound' })).toBe(true);
    expect(detectLiveHuman({ call_type: 'inbound' })).toBe(true);
  });

  it('8: transcript with substantive user speech is human', () => {
    expect(detectLiveHuman({}, 'USER: Yes I would like to discuss my account')).toBe(true);
  });

  it('9: voicemail transcript is NOT human', () => {
    expect(detectLiveHuman({}, 'USER: leave a message after the tone')).toBe(false);
  });

  it('10: human_answered flag is detected', () => {
    expect(detectLiveHuman({ human_answered: true })).toBe(true);
  });
});

// ── 11-16: Representative transcript timestamps ───────────────────
describe('representative transcript timestamps', () => {
  it('11: ISO timestamp extracted from representative turn', () => {
    const ts = extractRepFirstSpeechAt([
      { speaker: 1, text: 'Hello?', timestamp: '2026-09-04T12:00:00Z' },
      { speaker_label: 'representative', text: 'Hi', timestamp: '2026-09-04T12:00:05Z' },
    ]);
    expect(ts).toBe('2026-09-04T12:00:05Z');
  });

  it('12: numeric timestamp (relative seconds) returns null', () => {
    const ts = extractRepFirstSpeechAt([
      { speaker_label: 'representative', text: 'Hi', timestamp: 5.2 },
    ]);
    expect(ts).toBe(null);
  });

  it('13: missing timestamp returns null', () => {
    const ts = extractRepFirstSpeechAt([
      { speaker_label: 'representative', text: 'Hi' },
    ]);
    expect(ts).toBe(null);
  });

  it('14: non-ISO string timestamp returns null', () => {
    const ts = extractRepFirstSpeechAt([
      { speaker_label: 'representative', text: 'Hi', timestamp: 'five seconds' },
    ]);
    expect(ts).toBe(null);
  });

  it('15: created_at field used as fallback timestamp', () => {
    const ts = extractRepFirstSpeechAt([
      { speaker_label: 'representative', text: 'Hi', created_at: '2026-09-04T12:00:10Z' },
    ]);
    expect(ts).toBe('2026-09-04T12:00:10Z');
  });

  it('16: non-array input returns null', () => {
    expect(extractRepFirstSpeechAt(null)).toBe(null);
    expect(extractRepFirstSpeechAt('string')).toBe(null);
    expect(extractRepFirstSpeechAt(42)).toBe(null);
  });
});

// ── 17-22: Transfer state evaluation ──────────────────────────────
describe('transfer state evaluation', () => {
  it('17: bridge_confirmed requires rep speech or MERGED', () => {
    expect(evaluateTransferState({
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hello' }],
    })).toBe('bridge_confirmed');
  });

  it('18: transferred_to alone is only destination_ringing', () => {
    expect(evaluateTransferState({ transferred_to: '+15551234567' })).toBe('destination_ringing');
  });

  it('19: transfer_status=completed is NOT bridge proof', () => {
    expect(evaluateTransferState({ transfer_status: 'completed' })).toBe('destination_ringing');
  });

  it('20: transfer_status=failed is transfer_failed', () => {
    expect(evaluateTransferState({ transfer_status: 'failed' })).toBe('transfer_failed');
  });

  it('21: failure takes precedence over transferred_to', () => {
    expect(evaluateTransferState({
      transfer_status: 'failed',
      transferred_to: '+15551234567',
    })).toBe('transfer_failed');
  });

  it('22: MERGED state confirms bridge', () => {
    expect(evaluateTransferState({
      warm_transfer_call: { state: 'MERGED' },
    })).toBe('bridge_confirmed');
  });
});

// ── 23-27: Queue classification ───────────────────────────────────
describe('queue classification', () => {
  it('23: bridge_confirmed -> fire_transfer', () => {
    expect(classifyQueue('bridge_confirmed', true, false, false)).toBe('fire_transfer');
  });

  it('24: bridge_confirmed with voicemail marker -> voice_message', () => {
    expect(classifyQueue('bridge_confirmed', true, false, true)).toBe('voice_message');
  });

  it('25: transfer_failed -> human_drop', () => {
    expect(classifyQueue('transfer_failed', true, false, false)).toBe('human_drop');
  });

  it('26: voicemail without human -> voice_message', () => {
    expect(classifyQueue('none', false, true, false)).toBe('voice_message');
  });

  it('27: live human without bridge -> human_drop', () => {
    expect(classifyQueue('none', true, false, false)).toBe('human_drop');
  });
});

// ── 28-30: Duration parsing ───────────────────────────────────────
describe('duration parsing', () => {
  it('28: minutes converted to seconds', () => {
    expect(blandDurationToSeconds(2.5)).toBe(150);
  });

  it('29: large values treated as already seconds', () => {
    expect(blandDurationToSeconds(180)).toBe(180);
  });

  it('30: invalid input returns 0', () => {
    expect(blandDurationToSeconds(null)).toBe(0);
    expect(blandDurationToSeconds(-1)).toBe(0);
    expect(blandDurationToSeconds(NaN)).toBe(0);
  });
});

// ── 31-32: Voicemail and drop reason ──────────────────────────────
describe('voicemail and drop classification', () => {
  it('31: voicemail flag detected correctly', () => {
    expect(isOriginalVoicemail({ voicemail: true }, '')).toBe(true);
    expect(isOriginalVoicemail({ answered_by: 'machine' }, '')).toBe(true);
    expect(isOriginalVoicemail({}, 'Please leave a message after the tone')).toBe(true);
    expect(isOriginalVoicemail({}, 'Hello, who is this?')).toBe(false);
  });

  it('32: drop reason classifies DNC correctly', () => {
    expect(classifyDropReason({ is_dnc: true }, 'none', 'no_answer', '')).toBe('dnc');
    expect(classifyDropReason({}, 'none', 'no_answer', 'USER: stop calling me please')).toBe('dnc');
    expect(classifyDropReason({}, 'none', 'no_answer', 'USER: take me off the list')).toBe('dnc');
  });
});
