import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Play, RefreshCw, Voicemail } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';
interface Message { id: string; caller_number?: string; caller_name?: string; received_at: string; duration_seconds?: number; heard_at?: string }
interface Props { sessionToken: string; providerUrl: string; onUnauthorized: () => void; canCall: boolean; onCall: (number: string) => void }
export function PhoneVoicemail({ sessionToken, providerUrl, onUnauthorized, canCall, onCall }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivery, setDelivery] = useState(false);
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<{id: string; url: string} | null>(null);
  const [playingId, setPlayingId] = useState('');
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const request = useCallback(<T,>(body: Record<string, unknown>) => authFetch<T>(providerUrl, {
    body: { ...body, session_token: sessionToken }, onUnauthorized: () => auth.current(),
  }), [providerUrl, sessionToken]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const result = await request<{messages: Message[]; delivery_verified: boolean}>({ action: 'mailbox_list' });
    if (result.ok && result.data) { setMessages(result.data.messages); setDelivery(result.data.delivery_verified); }
    else setError(result.error || 'Could not load voicemail.');
    setLoading(false);
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function play(message: Message) {
    setPlayingId(message.id); setError('');
    const result = await request<{url: string}>({ action: 'mailbox_audio', id: message.id });
    if (result.ok && result.data) setAudio({ id: message.id, url: result.data.url });
    else setError(result.error || 'Could not load the recording.');
    setPlayingId('');
  }
  async function heard(id: string) {
    const result = await request({ action: 'mailbox_heard', id });
    if (result.ok) { setMessages(rows => rows.map(m => m.id === id ? { ...m, heard_at: new Date().toISOString() } : m)); window.dispatchEvent(new Event('f1-voicemail-heard')); }
  }
  return <div className="ip17-voicemail">
    <header><h3>Voicemail</h3><button aria-label="Refresh voicemail" disabled={loading} onClick={() => void load()}><RefreshCw size={17} /></button></header>
    <p className="ip17-vm-help">Listen here even when your phone is disconnected.</p>
    {error && <p className="ip17-error" role="alert">{error}</p>}
    {!delivery && !loading && !error && <p className="ip17-vm-setup">Voicemail delivery is awaiting setup and a test message. Your administrator can configure it in Test Calls.</p>}
    {!messages.length && <div className="ip17-vm-empty"><Voicemail size={34} /><p>{loading ? 'Loading messages…' : 'No saved messages'}</p></div>}
    {messages.map(message => <article key={message.id} className={message.heard_at ? '' : 'unheard'}>
      <div><strong>{message.caller_name || (message.caller_number ? formatPhone(message.caller_number) : 'Unknown caller')}</strong><time>{new Date(message.received_at).toLocaleString()}</time>{message.duration_seconds != null && <small>{Math.floor(message.duration_seconds / 60)}:{String(message.duration_seconds % 60).padStart(2,'0')}</small>}</div>
      <div className="ip17-vm-actions"><button disabled={playingId === message.id} onClick={() => void play(message)}><Play size={14} />{playingId === message.id ? 'Loading…' : 'Listen'}</button>{message.caller_number && <button aria-label={`Call back ${message.caller_number}`} disabled={!canCall} onClick={() => onCall(message.caller_number!)}><Phone size={15} /></button>}</div>
      {audio?.id === message.id && <audio controls autoPlay src={audio.url} onPlay={() => void heard(message.id)} onError={() => { setAudio(null); setError('Audio could not play. Press Listen to request a fresh link.'); }} />}
    </article>)}
  </div>;
}
