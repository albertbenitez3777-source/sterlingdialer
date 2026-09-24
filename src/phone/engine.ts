import { CallController, type PhoneApi, type PhoneEvent, type PhoneSession, type PhoneState } from './call-controller';

const CHANNEL = 'wolf-zadarma-v1';
const BASE = 'https://my.zadarma.com/webphoneWebRTCWidget/v8/js/';
interface Socket {
  on(event: string, callback: (...args: any[]) => void): Socket;
  close(): void;
}
interface Sdk extends PhoneApi {
  init(options: Record<string, unknown>): unknown;
  reg(sip: string): unknown;
  unreg(): void;
  unreg_old?(): void;
  unreg_flag: boolean;
  zadarmaCallbackCall(data: unknown): void;
  zadarmaCallbackAnswer(data: unknown): void;
  zadarmaCallbackCancel(data: unknown): void;
}
type IoFactory = ((url: string, options: unknown) => Socket) & Record<string, unknown>;
const ACtx = typeof AudioContext !== 'undefined' ? AudioContext
  : typeof (window as any).webkitAudioContext !== 'undefined' ? (window as any).webkitAudioContext as typeof AudioContext : null;
type PhoneWindow = Window & typeof globalThis & {
  ZDRMscriptDiv: HTMLElement;
  ZadarmaWebphoneAPI: new () => Sdk;
  io: IoFactory;
  wolfPhone?: WolfPhoneApi;
};

interface WolfPhoneApi {
  unlockAudio: () => void;
  enableSound: () => void;
  restoreMicTrack: () => Promise<{ ok: boolean; error?: string }>;
  getMicSenderState: () => { hasConnection: boolean; hasSender: boolean; trackState: string | null };
  getRemoteStreamState: () => { hasSrcObject: boolean; trackCount: number; liveTrackCount: number; muted: boolean; paused: boolean };
  startRingtone: () => void;
  stopRingtone: () => void;
  testSpeaker: () => void;
  setOutputDevice: (deviceId: string) => Promise<boolean>;
}

const host = window as PhoneWindow;
let controller: CallController | undefined;
let initialized = false;
let speakerMuted = false;
let connectionFailed = false;
let providerApi: Sdk | undefined;
const sockets = new Set<Socket>();
let connectionTimer: ReturnType<typeof setTimeout>;
let callTimer: ReturnType<typeof setTimeout>;
let endingTimer: ReturnType<typeof setTimeout>;
let ringtoneLoopTimer: ReturnType<typeof setInterval> | undefined;
let selectedOutputDevice: string | undefined;
const boundSessions = new WeakSet<PhoneSession>();
const emit = (event: PhoneEvent) => {
  if (window.parent !== window) window.parent.postMessage({ channel: CHANNEL, ...event }, window.location.origin);
};
const fail = (message: string) => emit({ type: 'error', message });
const remote = () => document.getElementById('zdrm-webRTCRemoteView') as HTMLMediaElement;
const ringtoneEl = () => document.getElementById('zdrm-incomingRing') as HTMLAudioElement | null;

function hasSinkId(el: HTMLMediaElement): el is HTMLMediaElement & { setSinkId: (id: string) => Promise<void>; sinkId: string } {
  return typeof (el as any).setSinkId === 'function';
}

async function applySinkId(el: HTMLMediaElement) {
  if (selectedOutputDevice && hasSinkId(el)) {
    try { await el.setSinkId(selectedOutputDevice); } catch { /* device unavailable, use default */ }
  }
}

function failConnection(message: string) {
  if (connectionFailed) return;
  connectionFailed = true;
  clearTimeout(connectionTimer);
  if (controller) controller.ready = false;
  if (providerApi) {
    providerApi.unreg_flag = true;
    try { providerApi.unreg_old?.(); } catch {}
    try { providerApi.unreg(); } catch {}
  }
  for (const socket of sockets) socket.close();
  emit({ type: 'connection', state: 'failed' });
  fail(message);
}

function createMedia() {
  const container = document.getElementById('phone-media')!;
  host.ZDRMscriptDiv = container;
  for (const id of ['zdrm-webRTCSelfView', 'zdrm-webRTCRemoteView']) {
    const media = document.createElement('audio');
    media.id = id; media.autoplay = true;
    media.setAttribute('playsinline', '');
    if (id.includes('Self')) media.muted = true;
    container.appendChild(media);
  }
  const sounds: Record<string, string> = {
    incomingRing: 'incoming-call.mp3', outgoingRing: 'out.wav', busy: 'busy.wav', hangup: 'hangup.wav',
  };
  for (let n = 0; n < 10; n++) sounds[`dtmf${n}`] = `dtmf-${n}.wav`;
  for (const [id, file] of Object.entries(sounds)) {
    const audio = document.createElement('audio'); audio.id = `zdrm-${id}`;
    audio.preload = 'auto'; audio.volume = 0.5; audio.src = `https://my.zadarma.com/assets/${file}`;
    container.appendChild(audio);
  }
}
createMedia();

function getAudioSender(): RTCRtpSender | null {
  const pc = providerApi?.webCallSession?.connection;
  if (!pc) return null;
  return pc.getSenders().find(s => s.track?.kind === 'audio' || (s as any).kind === 'audio') ?? null;
}

function rebindRemoteStream(): boolean {
  const pc = providerApi?.webCallSession?.connection;
  if (!pc) return false;
  const tracks = pc.getReceivers().map(r => r.track).filter(t => t && t.kind === 'audio');
  if (!tracks.length) return false;
  const el = remote();
  el.srcObject = new MediaStream(tracks);
  el.muted = speakerMuted;
  void applySinkId(el);
  void el.play().catch(() => emit({ type: 'audio-blocked', reason: 'playback' }));
  return true;
}

function stopRingtone() {
  if (ringtoneLoopTimer !== undefined) { clearInterval(ringtoneLoopTimer); ringtoneLoopTimer = undefined; }
  const ring = ringtoneEl();
  if (ring) { ring.pause(); ring.currentTime = 0; ring.loop = false; }
}

function startRingtone() {
  stopRingtone();
  const ring = ringtoneEl();
  if (!ring) return;
  ring.loop = true;
  ring.volume = 0.7;
  void applySinkId(ring);
  void ring.play().catch(() => {
    ring.loop = false;
    ringtoneLoopTimer = setInterval(() => {
      if (controller?.state !== 'ringing-in') { stopRingtone(); return; }
      void ring.play().catch(() => {});
    }, 2000);
  });
}

host.wolfPhone = {
  unlockAudio() {
    const el = remote();
    document.querySelectorAll('audio').forEach(audio => {
      if (audio.id.includes('Self')) return;
      if (audio === el && controller?.state === 'active') {
        if (audio.muted && !speakerMuted) audio.muted = false;
        void audio.play().catch(() => emit({ type: 'audio-blocked', reason: 'playback' }));
        return;
      }
      if (controller && controller.state !== 'idle') return;
      const previous = audio.volume; audio.volume = 0;
      void audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.volume = previous; }).catch(() => { audio.volume = previous; });
    });
  },
  enableSound() {
    const el = remote();
    if (!el) { emit({ type: 'audio-blocked', reason: 'playback' }); return; }
    if (el.muted && !speakerMuted) el.muted = false;

    const src = el.srcObject as MediaStream | null;
    const hasLiveTracks = src && src.getAudioTracks().some(t => t.readyState === 'live');
    if (!hasLiveTracks && controller && controller.state === 'active') {
      if (rebindRemoteStream()) {
        emit({ type: 'audio-recovered' });
        return;
      }
    }

    void el.play().then(() => {
      emit({ type: 'audio-recovered' });
    }).catch(() => {
      if (controller?.state === 'active' && rebindRemoteStream()) {
        emit({ type: 'audio-recovered' });
      } else {
        emit({ type: 'audio-blocked', reason: 'playback' });
      }
    });
    if (ACtx) { try { const ctx = new ACtx(); void ctx.resume().then(() => ctx.close()).catch(() => {}); } catch {} }

    if (controller?.state === 'ringing-in') startRingtone();
  },
  async restoreMicTrack() {
    const pc = providerApi?.webCallSession?.connection;
    if (!pc) return { ok: false, error: 'no-connection' };
    const sender = pc.getSenders().find(s => s.track?.kind === 'audio' || (!s.track && (s as any)._kind === 'audio'));
    if (!sender) return { ok: false, error: 'no-sender' };
    if (sender.track && sender.track.readyState === 'live' && sender.track.enabled) return { ok: true };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const newTrack = stream.getAudioTracks()[0];
      if (!newTrack) { stream.getTracks().forEach(t => t.stop()); return { ok: false, error: 'no-track' }; }
      await sender.replaceTrack(newTrack);
      if (controller?.muted) newTrack.enabled = false;
      return { ok: true };
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'NotAllowedError') return { ok: false, error: 'mic-denied' };
      if (name === 'NotFoundError') return { ok: false, error: 'mic-missing' };
      if (name === 'NotReadableError') return { ok: false, error: 'mic-in-use' };
      return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
    }
  },
  getMicSenderState() {
    const pc = providerApi?.webCallSession?.connection;
    if (!pc) return { hasConnection: false, hasSender: false, trackState: null };
    const sender = getAudioSender();
    return { hasConnection: true, hasSender: !!sender, trackState: sender?.track ? sender.track.readyState : null };
  },
  getRemoteStreamState() {
    const el = remote();
    const src = el?.srcObject as MediaStream | null;
    const tracks = src?.getAudioTracks() ?? [];
    return {
      hasSrcObject: !!src,
      trackCount: tracks.length,
      liveTrackCount: tracks.filter(t => t.readyState === 'live').length,
      muted: el?.muted ?? true,
      paused: el?.paused ?? true,
    };
  },
  startRingtone,
  stopRingtone,
  testSpeaker() {
    if (!ACtx) return;
    try {
      const ctx = new ACtx();
      if (selectedOutputDevice && typeof (ctx as any).setSinkId === 'function') {
        void (ctx as any).setSinkId(selectedOutputDevice).catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.stop(ctx.currentTime + 0.85);
      osc.onended = () => ctx.close();
    } catch {}
    const ring = ringtoneEl();
    if (ring) {
      const prev = ring.volume;
      ring.volume = 0.3;
      ring.currentTime = 0;
      void applySinkId(ring);
      void ring.play().then(() => { setTimeout(() => { ring.pause(); ring.currentTime = 0; ring.volume = prev; }, 2000); }).catch(() => {});
    }
  },
  async setOutputDevice(deviceId: string) {
    selectedOutputDevice = deviceId;
    const el = remote();
    if (!hasSinkId(el)) return false;
    try {
      await el.setSinkId(deviceId);
      const ring = ringtoneEl();
      if (ring && hasSinkId(ring)) await ring.setSinkId(deviceId);
      return true;
    } catch { return false; }
  },
};

function loadScript(name: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('Zadarma phone software timed out. Retry connection.')), 15000);
    script.src = BASE + name;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Zadarma phone software could not load. Check your connection or content blocker.')); };
    document.head.appendChild(script);
  });
}

function endCall() {
  clearTimeout(callTimer);
  clearTimeout(endingTimer);
  stopRingtone();
  document.querySelectorAll('audio').forEach(audio => { if (audio !== ringtoneEl()) audio.pause(); });
  speakerMuted = false; remote().muted = false;
  controller?.ended();
}

function bindSession(session: PhoneSession) {
  if (boundSessions.has(session)) return;
  boundSessions.add(session);
  const isCurrent = () => providerApi?.webCallSession === session;
  const bindAudio = (connection: RTCPeerConnection) => {
    const play = (stream: MediaStream) => {
      if (!isCurrent()) return;
      const el = remote();
      el.srcObject = stream;
      el.muted = false;
      void applySinkId(el);
      void el.play().catch(() => emit({ type: 'audio-blocked', reason: 'playback' }));
    };
    connection.addEventListener('track', event => play(event.streams[0] || new MediaStream([event.track])));
    const tracks = connection.getReceivers().map(receiver => receiver.track).filter(Boolean);
    if (tracks.length) play(new MediaStream(tracks));
  };
  session.on('peerconnection', ({ peerconnection }: { peerconnection: RTCPeerConnection }) => bindAudio(peerconnection));
  if (session.connection) bindAudio(session.connection);
  session.on('confirmed', () => {
    if (isCurrent()) {
      clearTimeout(callTimer);
      stopRingtone();
      controller?.confirmed();
    }
  });
  session.on('ended', () => { if (isCurrent()) endCall(); });
  session.on('failed', (event: { cause?: string }) => { if (isCurrent()) { endCall(); fail(`Call failed: ${event.cause || 'connection unavailable'}`); } });
  session.on('hold', () => { if (isCurrent()) emit({ type: 'controls', held: session.isOnHold().local }); });
  session.on('unhold', () => { if (isCurrent()) emit({ type: 'controls', held: session.isOnHold().local }); });
}

function hangup() {
  if (!controller || controller.state === 'idle' || controller.state === 'ending') return;
  const previous = controller.state;
  clearTimeout(callTimer);
  clearTimeout(endingTimer);
  stopRingtone();
  endingTimer = setTimeout(() => {
    if (controller?.state !== 'ending') return;
    failConnection('Call ending could not be confirmed. The phone disconnected; press Retry connection.');
    endCall();
  }, 15000);
  try { controller.hangup(); }
  catch (error) { clearTimeout(endingTimer); throw error; }
  if (previous === 'dialing' && !controller.api.webCallSession && (controller.state as PhoneState) === 'ending') endCall();
}

async function connect(key: string, sip: string) {
  if (initialized) return;
  initialized = true;
  emit({ type: 'connection', state: 'connecting' });
  try {
    for (const script of ['socket.io.js', 'detectWebRTC.min.js', 'jssip.min.js?v=7', 'md5.min.js', 'widget-api.min.js?sub_v=68']) await loadScript(script);
    const originalIo = host.io;
    host.io = Object.assign((url: string, options: unknown) => {
      const socket = originalIo(url, options);
      sockets.add(socket);
      socket.on('init', () => {
        if (connectionFailed) return;
        clearTimeout(connectionTimer);
        if (controller) controller.ready = true;
        emit({ type: 'connection', state: 'ready' });
      });
      socket.on('disconnect', () => {
        if (connectionFailed) return;
        if (controller) controller.ready = false;
        emit({ type: 'connection', state: 'connecting' });
        clearTimeout(connectionTimer);
        connectionTimer = setTimeout(() => {
          if (!controller?.ready) failConnection('Phone disconnected. Press Retry connection.');
        }, 20000);
      });
      socket.on('connect_error', () => {
        failConnection('Cannot connect to Zadarma. Check the network and retry.');
      });
      socket.on('update', (message: { error?: unknown; errorCode?: unknown }) => {
        if (message?.error || message?.errorCode) {
          failConnection('Zadarma rejected the phone connection. Check the extension and authorized website.');
        }
      });
      return socket;
    }, originalIo) as IoFactory;
    const api = new host.ZadarmaWebphoneAPI();
    providerApi = api;
    controller = new CallController(api, emit);
    let currentSession: PhoneSession | null = null;
    Object.defineProperty(api, 'webCallSession', {
      configurable: true,
      get: () => currentSession,
      set: (session: PhoneSession | null) => { currentSession = session; if (session) bindSession(session); },
    });
    for (const method of ['zadarmaCallbackCall', 'zadarmaCallbackAnswer', 'zadarmaCallbackCancel'] as const) {
      const original = api[method].bind(api);
      api[method] = data => {
        const allowed = method === 'zadarmaCallbackCall' ? ['dialing']
          : method === 'zadarmaCallbackAnswer' ? ['ringing-in', 'answering']
          : ['ending'];
        if (!connectionFailed && controller && allowed.includes(controller.state)) original(data);
      };
    }
    connectionTimer = setTimeout(() => {
      if (!controller?.ready) failConnection('Zadarma did not confirm the connection. Press Retry connection.');
    }, 20000);
    api.init({ key, sip, type: 'site', language: 'en',
      getSipsCallback: (sips: { all?: Array<{ name: string }> } | undefined, code: unknown) => {
        if (connectionFailed) return;
        if (code) {
          const detail = String(code).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
          failConnection(`Zadarma authorization failed${detail ? ` (${detail})` : ''}. Open the published website and retry.`);
          return;
        }
        if (!sips?.all?.some(item => item.name === sip)) {
          failConnection('Zadarma did not authorize your assigned extension. Ask your supervisor to check the phone assignment.');
          return;
        }
        api.reg(sip);
      },
      callbackGetPrice: () => {}, callbackEndCall: endCall,
      getStatusMessage: (status: string, data?: { caller?: string; callername?: string }) => {
        if (status === 'incoming') {
          controller?.incoming(String(data?.caller || 'Unknown caller'), String(data?.callername || ''));
          startRingtone();
        }
        if (['canceled', 'busy', 'rejected'].includes(status)) {
          stopRingtone();
          endCall();
          if (status !== 'canceled') fail(status === 'busy' ? 'The number is busy.' : 'The call was rejected.');
        }
        if (status === 'BROWSER_NOT_SUPPORTED') failConnection('Use a current desktop browser with microphone access.');
      },
    });
  } catch (error) { failConnection(error instanceof Error ? error.message : 'Phone setup failed.'); }
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.channel !== CHANNEL) return;
  const data = event.data;
  try {
    if (data.command === 'connect') { void connect(String(data.key || ''), String(data.sip || '')); return; }
    if (!controller) throw new Error('Enable the phone first.');
    if (data.command === 'dial') {
      if (typeof data.expiresAt === 'number' && Date.now() >= data.expiresAt) throw new Error('Call request expired. Please try again.');
      controller.dial(String(data.number || ''));
      if (data.requestId) emit({ type: 'dial-result', requestId: data.requestId, accepted: true });
    }
    else if (data.command === 'answer') {
      stopRingtone();
      if (controller.state === 'ringing-in') {
        controller.answer();
      }
    }
    else if (data.command === 'hangup') hangup();
    else if (data.command === 'mute') controller.mute();
    else if (data.command === 'hold') controller.hold();
    else if (data.command === 'dtmf') controller.dtmf(String(data.tone || ''));
    else if (data.command === 'speaker') { speakerMuted = !speakerMuted; remote().muted = speakerMuted; emit({ type: 'controls', speakerOff: speakerMuted }); }
    if (data.command === 'dial' || data.command === 'answer') {
      clearTimeout(callTimer);
      callTimer = setTimeout(() => {
        if (controller && ['dialing', 'answering'].includes(controller.state)) { hangup(); fail('The call did not connect within 60 seconds.'); }
      }, 60000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Phone action failed.';
    if (data.command === 'dial' && data.requestId) emit({ type: 'dial-result', requestId: data.requestId, accepted: false, message });
    fail(message);
  }
});
emit({ type: 'frame-ready' });
