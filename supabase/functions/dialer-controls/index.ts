import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createDbClient } from '../_shared/db-client.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apikey, X-Client-Info' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
// Only the four administrator controls. Provider calling stays in the existing worker.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 8192) return reply({ error: 'Request too large' }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body.session_token !== 'string') return reply({ error: 'Sign in as administrator' }, 401);
    const db = createDbClient('', Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const verified = await db.rpc('verify_session', { p_session_token: body.session_token });
    if (verified.error) return reply({ error: 'Session verification unavailable. Retry shortly.' }, 503);
    const actor = verified.data?.valid ? verified.data.agent : null;
    if (!actor) return reply({ error: 'Invalid or expired session' }, 401);
    if (!['owner', 'administrator'].includes(actor.role)) return reply({ error: 'Administrator access required' }, 403);
    const action = body.action;
    if (!['set_dialer_lines', 'set_agent_dialer_selection', 'start_campaign', 'stop_campaign'].includes(action)) return reply({ error: 'Unknown control' }, 400);
    if (action === 'set_agent_dialer_selection') {
      if (typeof body.selected !== 'boolean' || typeof body.agent_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.agent_id)) return reply({ error: 'Choose a valid agent and On or Off.' }, 400);
      const result = await db.rpc('set_agent_dialer_selection', { p_agent_id: body.agent_id, p_selected: body.selected });
      if (result.error || result.data?.success === false) return reply({ error: result.data?.error || 'Could not save agent selection.' }, 400);
      await db.from('audit_logs').insert({ actor_id: actor.id, action, entity_type: 'agent', entity_id: body.agent_id, metadata: { selected: body.selected } });
      return reply({ success: true, agent_id: body.agent_id, selected: body.selected });
    }
    if (action === 'stop_campaign') {
      const result = await db.rpc('campaign_stop');
      return result.error ? reply({ error: 'Could not stop the dialer.' }, 503) : reply(result.data);
    }
    const lines = body.concurrency === undefined && action === 'start_campaign' ? 3 : body.concurrency;
    if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1 || lines > 12) return reply({ error: 'Choose between 1 and 12 simultaneous lines.' }, 400);
    if (action === 'start_campaign') {
      if (!Number.isInteger(body.call_limit) || body.call_limit < 1 || body.call_limit > 2000) return reply({ error: 'Choose a call limit from 1 to 2000.' }, 400);
      const result = await db.rpc('campaign_start', { p_concurrency: lines, p_call_limit: body.call_limit });
      if (result.error) return reply({ error: 'Could not start the dialer. Check status before retrying.' }, 503);
      return reply(result.data, result.data?.success ? 200 : 409);
    }
    const current = await db.from('campaigns').select('id,concurrency,state').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (current.error) return reply({ error: 'Could not read dialer settings.' }, 503);
    if (!current.data) return reply({ error: 'No campaign found.' }, 404);
    const result = await db.from('campaigns').update({ concurrency: lines, updated_at: new Date().toISOString() }).eq('id', current.data.id);
    if (result.error) return reply({ error: `Could not save line limit: ${result.error.message}` }, 400);
    await db.from('audit_logs').insert({ actor_id: actor.id, action, entity_type: 'campaign', entity_id: current.data.id, metadata: { previous_concurrency: current.data.concurrency, new_concurrency: lines, campaign_state: current.data.state } });
    return reply({ success: true, concurrency: lines, previous_concurrency: current.data.concurrency });
  } catch { return reply({ error: 'Could not complete this control request. Refresh status before retrying.' }, 400); }
});
