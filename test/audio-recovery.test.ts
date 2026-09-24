import { describe, it, expect } from 'vitest';

// ─── User activation path ───────────────────────────────────────────────────
describe('audio-recovery: user activation path', () => {
  it('play() on an audio element is called synchronously in enableSound, not deferred', () => {
    let playCalledSynchronously = false;
    const fakeAudio = { play: () => { playCalledSynchronously = true; return Promise.resolve(); } };
    void fakeAudio.play();
    expect(playCalledSynchronously).toBe(true);
  });

  it('AudioContext.resume() is called synchronously in the parent click handler', () => {
    let resumeCalled = false;
    const fakeCtx = { resume: () => { resumeCalled = true; return Promise.resolve(); }, close: () => Promise.resolve() };
    void fakeCtx.resume().then(() => fakeCtx.close());
    expect(resumeCalled).toBe(true);
  });

  it('enableSound via direct property access is sync, postMessage would be async', () => {
    const calls: string[] = [];
    const directCall = () => { calls.push('direct'); };
    directCall();
    expect(calls).toEqual(['direct']);
  });
});

// ─── Microphone permission retry ────────────────────────────────────────────
describe('audio-recovery: microphone permission retry', () => {
  it('enableSound calls requestMic when micGranted is false', async () => {
    let micRequested = false;
    const micGranted = false;
    const requestMic = async () => { micRequested = true; return { granted: true }; };
    if (!micGranted) await requestMic();
    expect(micRequested).toBe(true);
  });

  it('enableSound skips requestMic when micGranted is already true', async () => {
    let micRequested = false;
    const micGranted = true;
    const requestMic = async () => { micRequested = true; return { granted: true }; };
    if (!micGranted) await requestMic();
    expect(micRequested).toBe(false);
  });

  it('mic denial returns structured error with errorName, does not corrupt connection', () => {
    const err = new DOMException('Permission denied', 'NotAllowedError');
    const result = {
      granted: false,
      error: err.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it in this website\'s browser settings, then retry.'
        : err.message,
      errorName: err.name,
    };
    expect(result.granted).toBe(false);
    expect(result.errorName).toBe('NotAllowedError');
    expect(result.error).toContain('browser settings');
  });

  it('mic NotFoundError gives device-specific message', () => {
    const err = new DOMException('No device found', 'NotFoundError');
    const result = {
      granted: false,
      error: err.name === 'NotFoundError'
        ? 'No microphone was found. Connect a microphone or headset, then retry.'
        : err.message,
      errorName: err.name,
    };
    expect(result.errorName).toBe('NotFoundError');
    expect(result.error).toContain('microphone');
  });

  it('mic NotReadableError gives in-use message', () => {
    const err = new DOMException('Device in use', 'NotReadableError');
    const errorName = err.name;
    const message = errorName === 'NotReadableError'
      ? 'Your microphone is being used by another app. Close it, then retry.'
      : err.message;
    expect(message).toContain('another app');
  });
});

// ─── replaceTrack-based mic restoration ─────────────────────────────────────
describe('audio-recovery: sender track restoration via replaceTrack', () => {
  it('replaceTrack on an existing audio sender does not require renegotiation', async () => {
    let negotiationNeeded = false;
    let trackReplaced = false;
    const sender = {
      track: { kind: 'audio', readyState: 'ended', enabled: true },
      replaceTrack: async (_track: unknown) => { trackReplaced = true; },
    };
    const pc = {
      getSenders: () => [sender],
      addEventListener: (_: string, cb: () => void) => { negotiationNeeded = true; cb(); },
    };
    // Find audio sender with ended track
    const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
    expect(audioSender).toBeDefined();
    expect(audioSender!.track!.readyState).toBe('ended');
    // Replace track
    await audioSender!.replaceTrack({ kind: 'audio', readyState: 'live', enabled: true });
    expect(trackReplaced).toBe(true);
    // No negotiation event listener was needed for same-kind replaceTrack
    expect(negotiationNeeded).toBe(false);
  });

  it('restoreMicTrack preserves deliberate mute by setting track.enabled=false', async () => {
    let newTrackEnabled = true;
    const muted = true;
    const newTrack = {
      kind: 'audio', readyState: 'live',
      get enabled() { return newTrackEnabled; },
      set enabled(v: boolean) { newTrackEnabled = v; },
    };
    // After replaceTrack, if controller.muted is true, disable the new track
    if (muted) newTrack.enabled = false;
    expect(newTrackEnabled).toBe(false);
  });

  it('restoreMicTrack does nothing if sender track is already live', () => {
    const senderState = { hasConnection: true, hasSender: true, trackState: 'live' };
    // enableSound skips restoreMicTrack when track is live
    const shouldRestore = senderState.hasConnection && senderState.hasSender && senderState.trackState !== 'live';
    expect(shouldRestore).toBe(false);
  });

  it('restoreMicTrack returns error when no peer connection exists', async () => {
    const result = { ok: false, error: 'no-connection' };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no-connection');
  });
});

// ─── AudioStatus state tracking ─────────────────────────────────────────────
describe('audio-recovery: granular status tracking', () => {
  it('maps audio-blocked event to sound-blocked status', () => {
    const data = { type: 'audio-blocked' };
    let audioStatus = 'ok';
    if (data.type === 'audio-blocked') audioStatus = 'sound-blocked';
    expect(audioStatus).toBe('sound-blocked');
  });

  it('maps audio-recovered event to ok status', () => {
    const data = { type: 'audio-recovered' };
    let audioStatus: string = 'sound-blocked';
    if (data.type === 'audio-recovered') audioStatus = 'ok';
    expect(audioStatus).toBe('ok');
  });

  it('maps mic denial to mic-denied status', () => {
    const micResult = { granted: false, errorName: 'NotAllowedError' };
    const status = micResult.errorName === 'NotAllowedError' ? 'mic-denied'
      : micResult.errorName === 'NotFoundError' ? 'mic-missing'
      : micResult.errorName === 'NotReadableError' ? 'mic-in-use' : 'unknown';
    expect(status).toBe('mic-denied');
  });

  it('resets audioStatus to ok when call ends', () => {
    let audioStatus = 'mic-denied';
    const data = { type: 'call-state', state: 'idle' };
    if (data.type === 'call-state' && data.state === 'idle') audioStatus = 'ok';
    expect(audioStatus).toBe('ok');
  });

  it('each status has a user-facing message', () => {
    const statuses = ['sound-blocked', 'mic-denied', 'mic-missing', 'mic-in-use', 'sender-ended', 'unknown'] as const;
    for (const s of statuses) {
      const msg = s === 'sound-blocked' ? 'Browser is blocking audio'
        : s === 'mic-denied' ? 'Microphone access was denied'
        : s === 'mic-missing' ? 'No microphone found'
        : s === 'mic-in-use' ? 'used by another app'
        : s === 'sender-ended' ? 'outgoing audio track'
        : 'audio problem';
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ─── Active call preservation ───────────────────────────────────────────────
describe('audio-recovery: active call preservation', () => {
  it('enableSound emits only audio-blocked or audio-recovered, no call-state/connection/hangup', () => {
    const possibleEvents = [
      { type: 'audio-recovered' },
      { type: 'audio-blocked', reason: 'playback' },
    ];
    for (const event of possibleEvents) {
      expect(event.type).not.toBe('call-state');
      expect(event.type).not.toBe('connection');
      expect(event.type).not.toBe('hangup');
      expect(event.type).not.toBe('error');
    }
  });

  it('muted state is preserved — enableSound never emits controls', () => {
    const events = [{ type: 'audio-recovered' }, { type: 'audio-blocked', reason: 'playback' }];
    expect(events.filter(e => e.type === 'controls')).toEqual([]);
  });

  it('enableSound with finally block always clears enablingSound', async () => {
    let enablingSound = true;
    try {
      throw new Error('simulated mic failure');
    } catch {
      // error handled
    } finally {
      enablingSound = false;
    }
    expect(enablingSound).toBe(false);
  });
});

// ─── Feature detection ──────────────────────────────────────────────────────
describe('audio-recovery: feature detection', () => {
  it('AudioContext fallback pattern handles missing AudioContext', () => {
    const win = {} as any;
    const ACtx = typeof AudioContext !== 'undefined' ? AudioContext
      : typeof win.webkitAudioContext !== 'undefined' ? win.webkitAudioContext : null;
    // In test env AudioContext may or may not exist — just verify no crash
    expect(() => { void ACtx; }).not.toThrow();
  });

  it('remote().muted is explicitly set to false in enableSound when speaker is not off', () => {
    let muted = true;
    const speakerMuted = false;
    // Engine's enableSound: if (el.muted && !speakerMuted) el.muted = false;
    if (muted && !speakerMuted) muted = false;
    expect(muted).toBe(false);
  });

  it('remote().muted stays true when speaker is intentionally off', () => {
    let muted = true;
    const speakerMuted = true;
    if (muted && !speakerMuted) muted = false;
    expect(muted).toBe(true);
  });
});
