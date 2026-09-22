import { zadarmaClient } from './zadarma.ts';
import { voicemailReceiverConfigured } from './mailbox.ts';

type Actor = { id: string; role: string };
export async function operations(db: any, actor: Actor, body: Record<string, unknown>) {
  const action = String(body.action || '');
  const respond = (data: unknown, status = 200) => ({ data, status });
  if (action === 'operations_overview') {
    const canSeeTeam = ['owner','administrator'].includes(actor.role);
    if (!canSeeTeam) return respond({ error: 'Administrator access required.' }, 403);
    const { data, error } = await db.rpc('get_operations_overview', { p_agent_id: canSeeTeam ? null : actor.id, p_window: ['today','week','all'].includes(String(body.window)) ? body.window : 'today' });
    if (error) return respond({ error: 'Call statistics are temporarily unavailable.' }, 503);
    return respond({ ...data, voicemail_import_configured: await voicemailReceiverConfigured(db) });
  }
  if (action === 'phone_activity') {
    const { data, error } = await db.from('federal_one_zadarma_calls').select('pbx_call_id,direction,caller_number,called_number,started_at,ended_at,answered_at,voicemail_reached,disposition,duration_seconds,recording_id,acknowledged_at')
      .eq('agent_id', actor.id).order('started_at', { ascending: false }).limit(50);
    if (error) return respond({ error: 'Recent calls are temporarily unavailable.' }, 503);
    const { data: conversations, error: conversationError } = await db.from('calls').select('id,consumer_name,consumer_phone,created_at,recording_url,ai_summary').eq('agent_id', actor.id).not('transfer_requested_at', 'is', null).order('created_at', { ascending: false }).limit(20);
    if (conversationError) return respond({ error: 'AI call history is temporarily unavailable.' }, 503);
    return respond({ calls: (data || []).map((row: any) => ({ ...row, recording_available: Boolean(row.recording_id), recording_id: undefined })), ai_calls: (conversations || []).map((row: any) => ({ ...row, recording_available: typeof row.recording_url === 'string' && row.recording_url.startsWith('https://'), recording_url: undefined })) });
  }
  if (action === 'phone_activity_read') {
    const id = String(body.id || '').slice(0,200);
    const { data, error } = await db.from('federal_one_zadarma_calls').update({ acknowledged_at: new Date().toISOString() }).eq('agent_id', actor.id).eq('pbx_call_id', id).select('pbx_call_id');
    if (error) return respond({ error: 'Call could not be marked read.' }, 503);
    return data?.length ? respond({ ok: true }) : respond({ error: 'Call not found.' }, 404);
  }
  if (action === 'phone_recording') {
    if (body.kind === 'ai') {
      const { data: ai, error: aiError } = await db.from('calls').select('recording_url').eq('agent_id', actor.id).eq('id', String(body.id || '')).not('transfer_requested_at', 'is', null).maybeSingle();
      if (aiError) return respond({ error: 'Recording lookup is unavailable.' }, 503);
      if (!ai?.recording_url?.startsWith('https://')) return respond({ error: 'The AI recording has not arrived yet.' }, 404);
      return respond({ url: ai.recording_url });
    }
    const { data: call, error } = await db.from('federal_one_zadarma_calls').select('pbx_call_id,recording_id').eq('agent_id', actor.id).eq('pbx_call_id', String(body.id || '').slice(0,200)).maybeSingle();
    if (error) return respond({ error: 'Recording lookup is unavailable.' }, 503);
    if (!call?.recording_id) return respond({ error: 'Zadarma has not supplied a recording for this call.' }, 404);
    try {
      const request = await zadarmaClient(db);
      const result = await request('/v1/pbx/record/request/', { call_id: call.recording_id, lifetime: '300' });
      const link = result.link;
      if (typeof link !== 'string' || !link.startsWith('https://')) return respond({ error: 'The recording is not ready yet. Try again shortly.' }, 409);
      return respond({ url: link });
    } catch { return respond({ error: 'The recording is temporarily unavailable. Try again shortly.' }, 503); }
  }
  return null;
}
