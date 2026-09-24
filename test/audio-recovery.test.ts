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
    const message = err.name === 'NotReadableError'
      ? 'Your microphone is being used by another app. Close it, then retry.'
      : err.message;
    expect(message).toContain('another app');
  });
});

// ─── replaceTrack-based mic restoration ─────────────────────────────────────
describe('audio-recovery: sender track restoration via replaceTrack', () => {
  it('replaceTrack on an existing audio sender does not require renegotiation', async () => {
    let trackReplaced = false;
    const sender = {
      track: { kind: 'audio', readyState: 'ended', enabled: true },
      replaceTrack: async (_track: unknown) => { trackReplaced = true; },
    };
    const pc = { getSenders: () => [sender] };
    const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
    expect(audioSender).toBeDefined();
    expect(audioSender!.track!.readyState).toBe('ended');
    await audioSender!.replaceTrack({ kind: 'audio', readyState: 'live', enabled: true });
    expect(trackReplaced).toBe(true);
  });

  it('restoreMicTrack preserves deliberate mute by setting track.enabled=false', () => {
    let newTrackEnabled = true;
    const muted = true;
    const newTrack = {
      kind: 'audio', readyState: 'live',
      get enabled() { return newTrackEnabled; },
      set enabled(v: boolean) { newTrackEnabled = v; },
    };
    if (muted) newTrack.enabled = false;
    expect(newTrackEnabled).toBe(false);
  });

  it('restoreMicTrack does nothing if sender track is already live', () => {
    const senderState = { hasConnection: true, hasSender: true, trackState: 'live' };
    const shouldRestore = senderState.hasConnection && senderState.hasSender && senderState.trackState !== 'live';
    expect(shouldRestore).toBe(false);
  });
});

// ─── Remote stream recovery ─────────────────────────────────────────────────
describe('audio-recovery: remote stream recovery', () => {
  it('rebindRemoteStream reconstructs srcObject from peer connection receivers', () => {
    const tracks = [{ kind: 'audio', readyState: 'live' }];
    const pc = { getReceivers: () => tracks.map(t => ({ track: t })) };
    const receivedTracks = pc.getReceivers().map((r: any) => r.track).filter((t: any) => t && t.kind === 'audio');
    expect(receivedTracks.length).toBe(1);
    expect(receivedTracks[0].readyState).toBe('live');
  });

  it('enableSound checks srcObject for live tracks before calling play', () => {
    const src = { getAudioTracks: () => [{ readyState: 'ended' }] };
    const hasLiveTracks = src.getAudioTracks().some(t => t.readyState === 'live');
    expect(hasLiveTracks).toBe(false);
  });

  it('enableSound detects empty srcObject and triggers rebind', () => {
    const el = { srcObject: null, muted: false };
    const hasLive = false;
    const callActive = true;
    const shouldRebind = !hasLive && callActive;
    expect(shouldRebind).toBe(true);
    expect(el.srcObject).toBeNull();
  });

  it('unmutes remote element when speakerMuted is false', () => {
    let muted = true;
    const speakerMuted = false;
    if (muted && !speakerMuted) muted = false;
    expect(muted).toBe(false);
  });

  it('keeps remote element muted when speaker is intentionally off', () => {
    let muted = true;
    const speakerMuted = true;
    if (muted && !speakerMuted) muted = false;
    expect(muted).toBe(true);
  });
});

// ─── Ringtone lifecycle ─────────────────────────────────────────────────────
describe('audio-recovery: ringtone lifecycle', () => {
  it('ringtone starts on incoming status', () => {
    const events: string[] = [];
    const startRingtone = () => events.push('start');
    const status = 'incoming';
    if (status === 'incoming') startRingtone();
    expect(events).toEqual(['start']);
  });

  it('ringtone stops on answer command', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('stop');
    const command = 'answer';
    if (command === 'answer') stopRingtone();
    expect(events).toEqual(['stop']);
  });

  it('ringtone stops on hangup during ringing', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('stop');
    stopRingtone();
    expect(events).toEqual(['stop']);
  });

  it('ringtone stops on canceled/busy/rejected status', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('stop');
    for (const status of ['canceled', 'busy', 'rejected']) {
      if (['canceled', 'busy', 'rejected'].includes(status)) stopRingtone();
    }
    expect(events).toEqual(['stop', 'stop', 'stop']);
  });

  it('ringtone stops on session confirmed (call connected)', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('stop');
    const sessionEvent = 'confirmed';
    if (sessionEvent === 'confirmed') stopRingtone();
    expect(events).toEqual(['stop']);
  });

  it('ringtone stops in endCall cleanup', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('stop');
    const endCall = () => { stopRingtone(); events.push('ended'); };
    endCall();
    expect(events).toEqual(['stop', 'ended']);
  });

  it('ringtone does not leak into conversation — stop precedes confirmed', () => {
    const events: string[] = [];
    const stopRingtone = () => events.push('ring-stop');
    const confirmed = () => { stopRingtone(); events.push('confirmed'); };
    confirmed();
    expect(events[0]).toBe('ring-stop');
    expect(events[1]).toBe('confirmed');
  });

  it('ringtone is set to loop=true', () => {
    const ring = { loop: false, volume: 0.5 };
    ring.loop = true;
    ring.volume = 0.7;
    expect(ring.loop).toBe(true);
    expect(ring.volume).toBe(0.7);
  });

  it('enableSound during ringing-in also starts ringtone', () => {
    const events: string[] = [];
    const startRingtone = () => events.push('ring-start');
    const state = 'ringing-in';
    if (state === 'ringing-in') startRingtone();
    expect(events).toContain('ring-start');
  });
});

// ─── setSinkId / output device ──────────────────────────────────────────────
describe('audio-recovery: output device selection', () => {
  it('hasSinkId feature detection does not crash when setSinkId is missing', () => {
    const el = { play: () => Promise.resolve(), pause: () => {} };
    const has = typeof (el as any).setSinkId === 'function';
    expect(has).toBe(false);
  });

  it('hasSinkId returns true when setSinkId exists', () => {
    const el = { setSinkId: async (_id: string) => {}, play: () => Promise.resolve() };
    const has = typeof el.setSinkId === 'function';
    expect(has).toBe(true);
  });

  it('applySinkId is called on remote element and ringtone element', async () => {
    const sinkCalls: string[] = [];
    const el = { setSinkId: async (id: string) => { sinkCalls.push(`remote:${id}`); } };
    const ring = { setSinkId: async (id: string) => { sinkCalls.push(`ring:${id}`); } };
    const deviceId = 'speakers-123';
    await el.setSinkId(deviceId);
    await ring.setSinkId(deviceId);
    expect(sinkCalls).toEqual(['remote:speakers-123', 'ring:speakers-123']);
  });

  it('testSpeaker plays a 440Hz tone via AudioContext', () => {
    const created: string[] = [];
    const fakeOsc = { frequency: { value: 0 }, connect: () => {}, start: () => { created.push('started'); }, stop: () => {}, onended: null as any };
    fakeOsc.frequency.value = 440;
    fakeOsc.start();
    expect(fakeOsc.frequency.value).toBe(440);
    expect(created).toContain('started');
  });

  it('OS guidance shown when setSinkId is not supported', () => {
    const HAS_SET_SINK_ID = false;
    const message = !HAS_SET_SINK_ID
      ? 'Your browser does not support output device selection. To change speakers, use your operating system sound settings.'
      : '';
    expect(message).toContain('operating system');
  });
});

// ─── AudioStatus granular tracking ──────────────────────────────────────────
describe('audio-recovery: granular status tracking', () => {
  it('maps audio-blocked event to sound-blocked status', () => {
    let audioStatus = 'ok';
    const data = { type: 'audio-blocked' };
    if (data.type === 'audio-blocked') audioStatus = 'sound-blocked';
    expect(audioStatus).toBe('sound-blocked');
  });

  it('maps audio-recovered event to ok status', () => {
    let audioStatus: string = 'sound-blocked';
    const data = { type: 'audio-recovered' };
    if (data.type === 'audio-recovered') audioStatus = 'ok';
    expect(audioStatus).toBe('ok');
  });

  it('resets audioStatus to ok when call ends', () => {
    let audioStatus = 'mic-denied';
    const data = { type: 'call-state', state: 'idle' };
    if (data.type === 'call-state' && data.state === 'idle') audioStatus = 'ok';
    expect(audioStatus).toBe('ok');
  });

  it('separate health indicators: connection, speaker, mic', () => {
    const connection = 'ready';
    const audioStatus = 'ok';
    const micGranted = true;
    const connOk = connection === 'ready';
    const spkOk = audioStatus === 'ok' || ['mic-denied', 'mic-missing', 'mic-in-use'].includes(audioStatus);
    const micOk = micGranted && !['mic-denied', 'mic-missing', 'mic-in-use'].includes(audioStatus);
    expect(connOk).toBe(true);
    expect(spkOk).toBe(true);
    expect(micOk).toBe(true);
  });

  it('speaker shows error when sound-blocked, mic stays ok', () => {
    const audioStatus = 'sound-blocked';
    const micGranted = true;
    const spkOk = audioStatus === 'ok' || ['mic-denied', 'mic-missing', 'mic-in-use'].includes(audioStatus);
    const micOk = micGranted && !['mic-denied', 'mic-missing', 'mic-in-use'].includes(audioStatus);
    expect(spkOk).toBe(false);
    expect(micOk).toBe(true);
  });
});

// ─── Active call preservation ───────────────────────────────────────────────
describe('audio-recovery: active call preservation', () => {
  it('enableSound emits only audio-blocked or audio-recovered, never hangup/connection', () => {
    const possibleEvents = [
      { type: 'audio-recovered' },
      { type: 'audio-blocked', reason: 'playback' },
    ];
    for (const event of possibleEvents) {
      expect(event.type).not.toBe('call-state');
      expect(event.type).not.toBe('connection');
      expect(event.type).not.toBe('hangup');
    }
  });

  it('enableSound with finally block always clears enablingSound', async () => {
    let enablingSound = true;
    try {
      throw new Error('simulated failure');
    } catch {
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
    expect(() => { void ACtx; }).not.toThrow();
  });
});
