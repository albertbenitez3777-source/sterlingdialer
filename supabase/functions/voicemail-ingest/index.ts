// Receives messages from a trusted receiving-mailbox adapter. Zadarma itself
// delivers native voicemail by email, not this JSON protocol. Until the adapter
// and VOICEMAIL_INGEST_SECRET are configured, this endpoint stays disabled.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('VOICEMAIL_INGEST_SECRET');
  if (!secret || secret.length < 32) return json({ error: 'Voicemail receiving integration is not configured' }, 503);
  const timestamp = req.headers.get('x-voicemail-timestamp') || '';
  const signature = req.headers.get('x-voicemail-signature') || '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return json({ error: 'Unauthorized' }, 401);
  if (Number(req.headers.get('content-length') || 0) > 22_000_000) return json({ error: 'Message is too large' }, 413);
  // Read with a hard bound even when Content-Length is omitted or inaccurate.
  const reader = req.body?.getReader();
  if (!reader) return json({ error: 'Missing body' }, 400);
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 22_000_000) { await reader.cancel(); return json({ error: 'Message is too large' }, 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder().decode(bytes);
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  if (!timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(signature))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = JSON.parse(raw);
    if (!['100','101','102'].includes(String(body.extension)) || typeof body.message_id !== 'string' || !body.message_id || body.message_id.length > 300 ||
      typeof body.audio_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio_base64)) return json({ error: 'Invalid message' }, 400);
    const audio = Uint8Array.from(atob(body.audio_base64), c => c.charCodeAt(0));
    if (audio.length < 16 || audio.length > 15_728_640) return json({ error: 'Invalid audio size' }, 400);
    const magic = new TextDecoder().decode(audio.slice(0, 4));
    const wav = magic === 'RIFF' && new TextDecoder().decode(audio.slice(8, 12)) === 'WAVE';
    const mp3 = magic.startsWith('ID3') || (audio[0] === 255 && (audio[1] & 224) === 224);
    const ogg = magic === 'OggS';
    if (!wav && !mp3 && !ogg) return json({ error: 'Unsupported audio' }, 400);
    const mime = wav ? 'audio/wav' : mp3 ? 'audio/mpeg' : 'audio/ogg';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: agent, error } = await db.from('agents').select('id').eq('zadarma_sip_login', `566918-${body.extension}`).single();
    if (error || !agent) return json({ error: 'Mailbox not found' }, 404);
    const { data: existing } = await db.from('federal_one_voicemails').select('id').eq('provider_message_id', body.message_id).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true });
    const path = `${agent.id}/${createHash('sha256').update(body.message_id).digest('hex')}.${wav ? 'wav' : mp3 ? 'mp3' : 'ogg'}`;
    const uploaded = await db.storage.from('agent-voicemail').upload(path, audio, { contentType: mime, upsert: true });
    if (uploaded.error) return json({ error: 'Audio could not be saved' }, 503);
    const received = typeof body.received_at === 'string' && Number.isFinite(Date.parse(body.received_at)) ? new Date(body.received_at).toISOString() : new Date().toISOString();
    const saved = await db.from('federal_one_voicemails').insert({ agent_id: agent.id, provider_message_id: body.message_id,
      caller_number: String(body.caller_number || '').replace(/[^+\d]/g, '').slice(0, 16) || null,
      caller_name: typeof body.caller_name === 'string' ? body.caller_name.slice(0, 120) : null,
      received_at: received, duration_seconds: Number.isInteger(body.duration_seconds) && body.duration_seconds >= 0 ? Math.min(body.duration_seconds, 3600) : null, storage_path: path });
    if (saved.error && saved.error.code !== '23505') return json({ error: 'Message could not be saved' }, 503);
    return json({ ok: true });
  } catch { return json({ error: 'Invalid message or receiving service unavailable' }, 400); }
});
