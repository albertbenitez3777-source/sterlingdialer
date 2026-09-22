import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const text = (value: unknown, max = 200) => String(value || '').slice(0, max);
const events = new Set(['NOTIFY_START','NOTIFY_INTERNAL','NOTIFY_ANSWER','NOTIFY_END','NOTIFY_OUT_START','NOTIFY_OUT_END','NOTIFY_RECORD']);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('zd_echo')) return new Response((url.searchParams.get('zd_echo') || '').slice(0, 500));
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'Missing body' }, 400);
    let raw = ''; let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 65536) { await reader.cancel(); return json({ error: 'Payload too large' }, 413); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const payload: Record<string, unknown> = req.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    const event = text(payload.event);
    if (!events.has(event)) return json({ error: 'Unsupported event' }, 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: config, error: configError } = await db.from('system_config').select('value').eq('key', 'zadarma_api_secret').maybeSingle();
    const secret = Deno.env.get('ZADARMA_API_SECRET') || config?.value;
    if (configError || !secret) return json({ error: 'Provider verification unavailable' }, 503);
    const signed = event === 'NOTIFY_RECORD' ? text(payload.pbx_call_id) + text(payload.call_id_with_rec)
      : event.startsWith('NOTIFY_OUT_') ? text(payload.internal) + text(payload.destination) + text(payload.call_start)
      : event === 'NOTIFY_ANSWER' ? text(payload.caller_id) + text(payload.destination) + text(payload.call_start)
      : text(payload.caller_id) + text(payload.called_did) + text(payload.call_start);
    const expected = btoa(createHmac('sha1', secret).update(signed).digest('hex'));
    const signature = req.headers.get('Signature') || '';
    if (signature.length !== expected.length || !timingSafeEqual(new TextEncoder().encode(signature), new TextEncoder().encode(expected))) return json({ error: 'Invalid provider signature' }, 401);
    const pbxId = text(payload.pbx_call_id);
    if (!/^[a-zA-Z0-9_.:-]{4,200}$/.test(pbxId)) return json({ error: 'Invalid call ID' }, 400);
    const { data: prior } = await db.from('federal_one_zadarma_calls').select('agent_id,direction,caller_number,called_number,started_at,extension').eq('pbx_call_id', pbxId).maybeSingle();
    const { data: agents, error: agentsError } = await db.from('agents').select('id,talkroute_number,zadarma_sip_login').eq('is_owner', false).eq('status', 'active');
    if (agentsError) return json({ error: 'Routes unavailable' }, 503);
    const outbound = event.startsWith('NOTIFY_OUT_') || prior?.direction === 'outbound';
    const extension = text(payload.internal || payload.last_internal || prior?.extension, 80);
    const did = digits(payload.called_did || (event === 'NOTIFY_ANSWER' ? payload.destination : '') || prior?.called_number);
    const route = agents?.find(a => a.id === prior?.agent_id) || agents?.find(a => !outbound && did.length >= 10 && digits(a.talkroute_number) === did)
      || agents?.find(a => String(a.zadarma_sip_login || '').split('-').pop() === extension);
    if (!route) return json({ ok: true, ignored: 'No assigned agent route' });
    const ownExtension = String(route.zadarma_sip_login || '').split('-').pop();
    const vm = /(^|\D)8500(\D|$)|voice\s*mail/i.test([extension,payload.last_internal,payload.destination].join(' '));
    const isAgentAnswer = !vm && String(payload.internal || '') === ownExtension && event === 'NOTIFY_ANSWER';
    const rawStart = text(payload.call_start, 40);
    // This PBX account reports timestamps in UTC-06:00; keep an existing call's original timestamp.
    const candidate = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(rawStart) ? new Date(rawStart.replace(' ','T') + '-06:00') : null;
    const started = prior?.started_at || (candidate && Number.isFinite(candidate.getTime()) ? candidate.toISOString() : new Date().toISOString());
    const normalized = {
      event_key: createHash('sha256').update(JSON.stringify([event,pbxId,extension,payload.call_start,payload.disposition,payload.duration,payload.call_id_with_rec])).digest('hex'),
      event_type: event, pbx_call_id: pbxId, agent_id: route.id, direction: outbound ? 'outbound' : 'inbound',
      caller_number: text(payload.caller_id || prior?.caller_number, 40), called_number: text(outbound ? payload.destination || prior?.called_number : payload.called_did || prior?.called_number || route.talkroute_number, 40),
      extension, started_at: started, agent_answered: isAgentAnswer, voicemail_reached: vm,
      disposition: text(payload.disposition, 80), duration_seconds: Math.max(0, Math.min(86400, Math.floor(Number(payload.duration) || 0))),
      recording_id: (event === 'NOTIFY_RECORD' || ['1','true'].includes(String(payload.is_recorded))) ? text(payload.call_id_with_rec, 250) || null : null,
    };
    const { data, error } = await db.rpc('record_zadarma_call_event', { p_event: normalized });
    if (error) { console.error('Zadarma event save failed', error.code); return json({ error: 'Event could not be saved' }, 503); }
    return json(data);
  } catch (e) {
    console.error('Zadarma event failed', e instanceof Error ? e.name : 'Unknown error');
    return json({ error: 'Invalid provider event' }, 400);
  }
});
