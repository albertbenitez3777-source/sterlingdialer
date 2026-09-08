import { describe, it, expect } from 'vitest';

// ── Inline copies of webhook helper functions for unit testing ──
// These mirror the production functions in wolf-webhook/index.ts

type TransferState = 'none' | 'transfer_requested' | 'transfer_api_accepted' | 'destination_ringing' | 'human_answered' | 'transfer_failed' | 'bridge_ended';

function hasRepresentativeSpeech(raw: unknown): boolean {
  if (!raw) return false;
  if (Array.isArray(raw)) {
    return raw.some((turn: Record<string, unknown>) => {
      const text = String(turn.text || turn.content || turn.message || '').trim();
      if (!text) return false;
      const speakerLabel = String(turn.speaker_label || '').toLowerCase();
      const speaker = turn.speaker;
      if (speakerLabel === 'representative') return true;
      if (speaker === 2 || speaker === '2') return true;
      return false;
    });
  }
  return false;
}

function extractRepFirstSpeechAt(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const turn of raw) {
    const t = turn as Record<string, unknown>;
    const text = String(t.text || t.content || t.message || '').trim();
    if (!text) continue;
    const speakerLabel = String(t.speaker_label || '').toLowerCase();
    const speaker = t.speaker;
    if (speakerLabel === 'representative' || speaker === 2 || speaker === '2') {
      const ts = t.timestamp || t.time || t.started_at || t.start;
      if (ts) return String(ts);
      return null;
    }
  }
  return null;
}

function blandDurationToSeconds(raw: unknown): number {
  const minutes = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  if (isNaN(minutes) || minutes <= 0) return 0;
  if (minutes > 100) return Math.round(minutes);
  return Math.round(minutes * 60);
}

function evaluateTransferState(body: Record<string, unknown>): TransferState {
  const ts = String(body.transfer_status || '').toLowerCase();
  const transferObj = body.transfer as Record<string, unknown> | undefined;
  const callStatus = String(body.status || '').toLowerCase();
  if (ts === 'unsuccessful' || ts === 'failed') return 'transfer_failed';
  if (transferObj?.status && ['failed', 'unsuccessful'].includes(String(transferObj.status).toLowerCase())) return 'transfer_failed';
  if (['no_answer', 'no-answer', 'timed_out', 'timed-out', 'failed', 'cancelled', 'canceled'].includes(callStatus)) return 'transfer_failed';
  if (hasRepresentativeSpeech(body.post_transfer_transcript)) return 'bridge_ended';
  const warmTransferState = String(body.warm_transfer_state || body.transfer_state || '').toUpperCase();
  if (warmTransferState === 'MERGED') return 'bridge_ended';
  if (body.transferred_to && String(body.transferred_to).trim()) return 'destination_ringing';
  if (body.transferred_at) return 'destination_ringing';
  if (ts === 'transferring' || ts === 'ringing') return 'destination_ringing';
  if (transferObj?.status && ['ringing', 'transferring'].includes(String(transferObj.status).toLowerCase())) return 'destination_ringing';
  if (ts === 'requested' || ts === 'accepted' || body.transfer_requested === true) return 'transfer_api_accepted';
  if (transferObj?.status && ['requested', 'accepted'].includes(String(transferObj.status).toLowerCase())) return 'transfer_api_accepted';
  const transcriptRaw = body.transcripts || body.concatenated_transcript || body.transcript;
  const transcriptStr = typeof transcriptRaw === 'string' ? transcriptRaw :
    Array.isArray(transcriptRaw) ? transcriptRaw.map((t: Record<string, unknown>) => String(t.text || t.content || '')).join(' ') : '';
  const transcriptLower = transcriptStr.toLowerCase();
  if (transcriptLower.includes('agent-action: transferring to:') || transcriptLower.includes('transferring to: +')) return 'transfer_api_accepted';
  if (transcriptLower.includes('connecting you now')) return 'transfer_api_accepted';
  return 'none';
}

function classifyDropReason(body: Record<string, unknown>, transferState: TransferState, queue: string, transcript: string): string {
  const callStatus = String(body.status || '').toLowerCase();
  const answeredBy = String(body.answered_by || '').toLowerCase();
  const lower = transcript.toLowerCase();
  if (body.is_dnc === true || lower.includes('do not call') || lower.includes('remove me') || lower.includes('stop calling') || lower.includes('take me off')) return 'dnc';
  if (lower.includes('wrong number') || lower.includes('wrong person') || lower.includes('not me') || body.is_wrong_number === true) return 'wrong_person';
  if (lower.includes('not interested') || lower.includes('no thank') || lower.includes('i decline')) return 'declined';
  if (answeredBy === 'voicemail' || answeredBy === 'machine' || body.voicemail === true || body.is_voicemail === true) return 'voicemail';
  if (lower.includes('leave a message') || lower.includes('after the tone') || lower.includes('does not accept solicitations')) return 'voicemail';
  if (callStatus === 'no_answer' || callStatus === 'no-answer') return 'no_answer';
  if (callStatus === 'busy') return 'busy';
  if (transferState === 'transfer_failed') {
    const reason = String(body.transfer_failure_reason || '').toLowerCase();
    if (reason.includes('no answer') || reason.includes('no-answer') || reason.includes('timed')) return 'transfer_no_answer';
    if (reason.includes('busy')) return 'transfer_busy';
    if (reason.includes('cancel')) return 'transfer_cancelled';
    return 'transfer_provider_error';
  }
  if (transferState === 'bridge_ended') {
    if (hasRepresentativeSpeech(body.post_transfer_transcript)) return 'bridge_confirmed';
    return 'bridge_ended_no_speech';
  }
  if (queue === 'human_drop') {
    if (lower.includes('hung up') || lower.includes('disconnected')) return 'hangup_before_transfer';
    return 'human_drop';
  }
  if (callStatus === 'failed' || callStatus === 'error') return 'provider_error';
  if (callStatus === 'timeout' || callStatus === 'timed_out' || callStatus === 'timed-out') return 'timeout';
  const durationSec = blandDurationToSeconds(body.call_length ?? body.duration);
  if (durationSec > 0 && durationSec < 5) return 'silence';
  return 'none';
}

// ── Tests ──

describe('hasRepresentativeSpeech', () => {
  it('returns true for speaker_label=representative with text', () => {
    expect(hasRepresentativeSpeech([{ speaker_label: 'representative', text: 'Hello this is Mark' }])).toBe(true);
  });
  it('returns true for speaker=2 numeric with text', () => {
    expect(hasRepresentativeSpeech([{ speaker: 2, text: 'Yes I can help' }])).toBe(true);
  });
  it('returns true for speaker="2" string with text', () => {
    expect(hasRepresentativeSpeech([{ speaker: '2', text: 'Hello?' }])).toBe(true);
  });
  it('returns false for representative with empty text', () => {
    expect(hasRepresentativeSpeech([{ speaker_label: 'representative', text: '' }])).toBe(false);
  });
  it('returns false for user/caller only', () => {
    expect(hasRepresentativeSpeech([{ speaker_label: 'user', text: 'I need help' }])).toBe(false);
  });
  it('returns false for null/undefined', () => {
    expect(hasRepresentativeSpeech(null)).toBe(false);
    expect(hasRepresentativeSpeech(undefined)).toBe(false);
  });
  it('returns false for empty array', () => {
    expect(hasRepresentativeSpeech([])).toBe(false);
  });
});

describe('extractRepFirstSpeechAt', () => {
  it('returns timestamp from first rep turn', () => {
    const transcript = [
      { speaker_label: 'user', text: 'Hello?', timestamp: '2025-01-01T10:00:00Z' },
      { speaker_label: 'representative', text: 'Hi this is Mark', timestamp: '2025-01-01T10:00:05Z' },
      { speaker_label: 'representative', text: 'How can I help', timestamp: '2025-01-01T10:00:10Z' },
    ];
    expect(extractRepFirstSpeechAt(transcript)).toBe('2025-01-01T10:00:05Z');
  });
  it('returns null when no rep speech', () => {
    expect(extractRepFirstSpeechAt([{ speaker_label: 'user', text: 'Hello' }])).toBe(null);
  });
  it('returns null for non-array', () => {
    expect(extractRepFirstSpeechAt('some string')).toBe(null);
    expect(extractRepFirstSpeechAt(null)).toBe(null);
  });
  it('returns null when rep has no timestamp', () => {
    expect(extractRepFirstSpeechAt([{ speaker_label: 'representative', text: 'Hi' }])).toBe(null);
  });
  it('uses speaker=2 with time field', () => {
    expect(extractRepFirstSpeechAt([{ speaker: 2, text: 'Hi', time: '10:00:05' }])).toBe('10:00:05');
  });
});

describe('evaluateTransferState', () => {
  it('returns bridge_ended when post_transfer_transcript has rep speech', () => {
    expect(evaluateTransferState({
      post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hello this is James' }],
    })).toBe('bridge_ended');
  });
  it('returns bridge_ended for warm_transfer_state MERGED', () => {
    expect(evaluateTransferState({ warm_transfer_state: 'MERGED' })).toBe('bridge_ended');
  });
  it('returns transfer_failed for unsuccessful transfer_status', () => {
    expect(evaluateTransferState({ transfer_status: 'unsuccessful' })).toBe('transfer_failed');
  });
  it('returns transfer_failed for no-answer call status', () => {
    expect(evaluateTransferState({ status: 'no-answer' })).toBe('transfer_failed');
  });
  it('returns destination_ringing for transferred_to present', () => {
    expect(evaluateTransferState({ transferred_to: '+12125551234' })).toBe('destination_ringing');
  });
  it('returns transfer_api_accepted for requested status', () => {
    expect(evaluateTransferState({ transfer_status: 'requested' })).toBe('transfer_api_accepted');
  });
  it('returns transfer_api_accepted for connecting you now in transcript', () => {
    expect(evaluateTransferState({ concatenated_transcript: 'Connecting you now to the representative' })).toBe('transfer_api_accepted');
  });
  it('returns none for empty body', () => {
    expect(evaluateTransferState({})).toBe('none');
  });
  it('does NOT infer bridge from transferred_to alone', () => {
    expect(evaluateTransferState({ transferred_to: '+12125551234' })).not.toBe('bridge_ended');
  });
  it('does NOT infer bridge from completed status', () => {
    expect(evaluateTransferState({ status: 'completed', transferred_to: '+12125551234' })).not.toBe('bridge_ended');
  });
  it('does NOT infer bridge from fire_transfer or duration', () => {
    const result = evaluateTransferState({ transfer_status: 'successful', duration: '5.5' });
    expect(result).not.toBe('bridge_ended');
  });
});

describe('classifyDropReason', () => {
  it('classifies DNC from transcript', () => {
    expect(classifyDropReason({}, 'none', 'human_drop', 'Please do not call me again')).toBe('dnc');
  });
  it('classifies DNC from body flag', () => {
    expect(classifyDropReason({ is_dnc: true }, 'none', 'no_answer', '')).toBe('dnc');
  });
  it('classifies wrong person', () => {
    expect(classifyDropReason({}, 'none', 'human_drop', 'That is the wrong number you have')).toBe('wrong_person');
  });
  it('classifies declined', () => {
    expect(classifyDropReason({}, 'none', 'human_drop', 'I am not interested in what you are selling')).toBe('declined');
  });
  it('classifies voicemail from answered_by', () => {
    expect(classifyDropReason({ answered_by: 'voicemail' }, 'none', 'voice_message', '')).toBe('voicemail');
  });
  it('classifies voicemail from transcript marker', () => {
    expect(classifyDropReason({}, 'none', 'voice_message', 'Please leave a message after the tone')).toBe('voicemail');
  });
  it('classifies no_answer from status', () => {
    expect(classifyDropReason({ status: 'no_answer' }, 'none', 'no_answer', '')).toBe('no_answer');
  });
  it('classifies busy from status', () => {
    expect(classifyDropReason({ status: 'busy' }, 'none', 'no_answer', '')).toBe('busy');
  });
  it('classifies transfer_no_answer', () => {
    expect(classifyDropReason({ transfer_failure_reason: 'No answer from agent' }, 'transfer_failed', 'human_drop', '')).toBe('transfer_no_answer');
  });
  it('classifies transfer_busy', () => {
    expect(classifyDropReason({ transfer_failure_reason: 'Destination busy' }, 'transfer_failed', 'human_drop', '')).toBe('transfer_busy');
  });
  it('classifies transfer_provider_error for generic failure', () => {
    expect(classifyDropReason({ transfer_failure_reason: 'Unknown error' }, 'transfer_failed', 'human_drop', '')).toBe('transfer_provider_error');
  });
  it('classifies bridge_confirmed when rep speech present', () => {
    expect(classifyDropReason(
      { post_transfer_transcript: [{ speaker_label: 'representative', text: 'Hello' }] },
      'bridge_ended', 'fire_transfer', ''
    )).toBe('bridge_confirmed');
  });
  it('classifies human_drop for hangup before transfer', () => {
    expect(classifyDropReason({}, 'none', 'human_drop', 'The caller hung up before we could transfer')).toBe('hangup_before_transfer');
  });
  it('classifies provider_error', () => {
    expect(classifyDropReason({ status: 'failed' }, 'none', 'no_answer', '')).toBe('provider_error');
  });
  it('classifies timeout', () => {
    expect(classifyDropReason({ status: 'timed_out' }, 'none', 'no_answer', '')).toBe('timeout');
  });
  it('classifies silence for very short calls', () => {
    expect(classifyDropReason({ call_length: '0.05' }, 'none', 'no_answer', '')).toBe('silence');
  });
  it('returns none for unclassifiable', () => {
    expect(classifyDropReason({ call_length: '2.0' }, 'none', 'pending', '')).toBe('none');
  });
  it('DNC takes priority over other classifications', () => {
    expect(classifyDropReason({ answered_by: 'voicemail' }, 'none', 'voice_message', 'Stop calling me, do not call')).toBe('dnc');
  });
  it('wrong_person takes priority over voicemail', () => {
    expect(classifyDropReason({ answered_by: 'voicemail' }, 'none', 'voice_message', 'This is the wrong person')).toBe('wrong_person');
  });
});
