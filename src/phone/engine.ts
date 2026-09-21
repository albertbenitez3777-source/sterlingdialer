import { CallController, type PhoneApi, type PhoneEvent, type PhoneSession, type PhoneState } from './call-controller';

// Run the provider's SDK in its own same-origin frame. Removing the frame on
// logout/reconnect closes every SDK socket, timer, audio track and global hook.
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
type PhoneWindow = Window & typeof globalThis & {
  ZDRMscriptDiv: HTMLElement;
  ZadarmaWebphoneAPI: new () => Sdk;
  io: IoFactory;
  wolfPhone?: { unlockAudio: () => void };
};
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
const boundSessions = new WeakSet<PhoneSession>();
const emit = (event: PhoneEvent) => {
  if (window.parent !== window) window.parent.postMessage({ channel: CHANNEL, ...event }, window.location.origin);
};
const fail = (message: string) => emit({ type: 'error', message });
const remote = () => document.getElementById('zdrm-webRTCRemoteView') as HTMLMediaElement;

function failConnection(message: string) {
  if (connectionFailed) return;
  connectionFailed = true;
  clearTimeout(connectionTimer);
  if (controller) controller.ready = false;
  // Stop the vendor's automatic reconnect loop before closing its socket.
  // A rejected authorization must remain failed until the agent retries.
  if (providerApi) {
    providerApi.unreg_flag = true;
    try { providerApi.unreg_old?.(); } catch { /* Continue closing the push connection. */ }
    try { providerApi.unreg(); } catch { /* The socket may already have closed. */ }
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
host.wolfPhone = { unlockAudio() {
  // Called synchronously by a click in the parent, before awaiting microphone access.
  document.querySelectorAll('audio').forEach(audio => {
    if (audio.id.includes('Self')) return;
    if (audio === remote() && controller?.state === 'active') {
      void audio.play().catch(() => fail('Click Enable sound to hear the caller.')); return;
    }
    if (controller && controller.state !== 'idle') return;
    const previous = audio.volume; audio.volume = 0;
    void audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.volume = previous; }).catch(() => { audio.volume = previous; });
  });
} };

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
  document.querySelectorAll('audio').forEach(audio => { audio.pause(); });
  speakerMuted = false; remote().muted = false;
  controller?.ended();
}

function bindSession(session: PhoneSession) {
  // The SDK assigns the same session from both newRTCSession and UA.call().
  // Bind once, and prevent late events from an old session changing a new call.
  if (boundSessions.has(session)) return;
  boundSessions.add(session);
  const isCurrent = () => providerApi?.webCallSession === session;
  // Use JsSIP session methods for mute, hold and all 12 DTMF keys.
  // The vendor widget's visual control helpers do not support these reliably.
  const bindAudio = (connection: RTCPeerConnection) => {
    const play = (stream: MediaStream) => {
      if (!isCurrent()) return;
      remote().srcObject = stream;
      void remote().play().catch(() => fail('Click Enable sound to hear the caller.'));
    };
    connection.addEventListener('track', event => play(event.streams[0] || new MediaStream([event.track])));
    const tracks = connection.getReceivers().map(receiver => receiver.track).filter(Boolean);
    if (tracks.length) play(new MediaStream(tracks));
  };
  session.on('peerconnection', ({ peerconnection }: { peerconnection: RTCPeerConnection }) => bindAudio(peerconnection));
  if (session.connection) bindAudio(session.connection);
  session.on('confirmed', () => { if (isCurrent()) { clearTimeout(callTimer); controller?.confirmed(); } });
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
  endingTimer = setTimeout(() => {
    if (controller?.state !== 'ending') return;
    failConnection('Call ending could not be confirmed. The phone disconnected; press Retry connection.');
    endCall();
  }, 15000);
  try { controller.hangup(); }
  catch (error) { clearTimeout(endingTimer); throw error; }
  // A canceled outgoing credential lookup has no SIP leg to terminate.
  if (previous === 'dialing' && !controller.api.webCallSession && (controller.state as PhoneState) === 'ending') endCall();
}

async function connect(key: string, sip: string) {
  if (initialized) return;
  initialized = true;
  emit({ type: 'connection', state: 'connecting' });
  try {
    // Ordered loading avoids the race in the vendor's asynchronous loader.
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
    // A late JSONP response must never start a call the agent already cancelled.
    for (const method of ['zadarmaCallbackCall', 'zadarmaCallbackAnswer', 'zadarmaCallbackCancel'] as const) {
      const original = api[method].bind(api);
      api[method] = data => {
        const expected = method === 'zadarmaCallbackCall' ? 'dialing' : method === 'zadarmaCallbackAnswer' ? 'answering' : 'ending';
        if (!connectionFailed && controller?.state === expected) original(data);
      };
    }
    connectionTimer = setTimeout(() => {
      if (!controller?.ready) failConnection('Zadarma did not confirm the connection. Press Retry connection.');
    }, 20000);
    // /v1/webrtc/get_key/ issues a website widget key, not a CRM integration key.
    // CRM mode rejects this valid key with integrationDisabled.
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
        // Only open the push connection after the assigned extension is authorized.
        api.reg(sip);
      },
      callbackGetPrice: () => {}, callbackEndCall: endCall,
      getStatusMessage: (status: string, data?: { caller?: string; callername?: string }) => {
        if (status === 'incoming') controller?.incoming(String(data?.caller || 'Unknown caller'), String(data?.callername || ''));
        if (['canceled', 'busy', 'rejected'].includes(status)) {
          endCall(); if (status !== 'canceled') fail(status === 'busy' ? 'The number is busy.' : 'The call was rejected.');
        }
        if (status === 'BROWSER_NOT_SUPPORTED') failConnection('Use a current desktop browser with microphone access.');
        // 'registered', 'connected' and 'accepted' are optimistic SDK UI messages.
        // Readiness uses the authenticated push handshake; answer uses SIP confirmed.
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
    if (data.command === 'dial') controller.dial(String(data.number || ''));
    else if (data.command === 'answer') controller.answer();
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
  } catch (error) { fail(error instanceof Error ? error.message : 'Phone action failed.'); }
});
emit({ type: 'frame-ready' });
