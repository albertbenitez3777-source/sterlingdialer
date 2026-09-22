import { createHash, createHmac } from 'node:crypto';

const DOMAIN = 'wolf-of-wall-street-ssy3.bolt.host';
type Params = Record<string, string>;

export function signZadarma(method: string, params: Params, secret: string) {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
  const digest = createHash('md5').update(query).digest('hex');
  const signature = btoa(createHmac('sha1', secret).update(method + query + digest).digest('hex'));
  return { query, signature };
}

export async function zadarmaClient(supabase: any) {
  const { data: rows, error } = await supabase.from('system_config').select('key,value')
    .in('key', ['zadarma_api_key', 'zadarma_api_secret']);
  if (error) throw new Error('Phone service settings are unavailable.');
  const config = Object.fromEntries((rows || []).map((row: { key: string; value: string }) => [row.key, row.value]));
  const key = Deno.env.get('ZADARMA_API_KEY') || config.zadarma_api_key || '';
  const secret = Deno.env.get('ZADARMA_API_SECRET') || config.zadarma_api_secret || '';
  if (!key || !secret) throw new Error('Zadarma API credentials are not configured.');
  return async (path: string, params: Params = {}, method = 'GET') => {
    const signed = signZadarma(path, params, secret);
    const response = await fetch(`https://api.zadarma.com${path}${method === 'GET' && signed.query ? `?${signed.query}` : ''}`, {
      method, headers: { Authorization: `${key}:${signed.signature}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(method === 'GET' ? {} : { body: signed.query }), signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success') throw new Error(String(data.message || `Zadarma returned HTTP ${response.status}`).slice(0, 240));
    return data;
  };
}

export async function zadarma(supabase: any, agent: { id: string; role: string }, body: Record<string, unknown>) {
  const respond = (data: unknown, status = 200) => ({ data, status });
  const action = String(body.action || '');
  const { data: route, error: routeError } = await supabase.from('agents')
    .select('zadarma_sip_login,talkroute_number,bland_number').eq('id', agent.id).single();
  if (routeError) return respond({ error: 'Agent phone settings are unavailable.' }, 503);

  if (action === 'zadarma_caller_context') {
    const digits = String(body.phone || '').replace(/\D/g, '');
    if (!/^1?\d{10}$/.test(digits)) return respond({ caller: null });
    const last10 = digits.slice(-10);
    const phones = [last10, `1${last10}`, `+1${last10}`];
    const { data: calls, error } = await supabase.from('calls')
      .select('consumer_name,consumer_phone,consumer_address,consumer_custom_fields,ai_summary,transcript')
      .eq('agent_id', agent.id).in('consumer_phone', phones).order('created_at', { ascending: false }).limit(1);
    if (error) return respond({ error: 'Caller details are temporarily unavailable.' }, 503);
    const call = calls?.[0];
    if (call) return respond({ caller: { name: call.consumer_name, phone: call.consumer_phone,
      address: call.consumer_address, fields: call.consumer_custom_fields, summary: call.ai_summary, transcript: call.transcript } });
    const { data: leads } = await supabase.from('leads').select('name,telephone_original,address,custom_fields')
      .eq('assigned_agent_id', agent.id).in('telephone_normalized', phones).limit(1);
    const lead = leads?.[0];
    return respond({ caller: lead ? { name: lead.name, phone: lead.telephone_original, address: lead.address, fields: lead.custom_fields } : null });
  }

  if (!['zadarma_callback', 'zadarma_webrtc_key', 'zadarma_setup_webrtc', 'zadarma_check_incoming', 'zadarma_setup_incoming', 'zadarma_setup_voicemail'].includes(action)) return respond({ error: 'Unknown phone action.' }, 400);
  if (['zadarma_setup_webrtc', 'zadarma_check_incoming', 'zadarma_setup_incoming', 'zadarma_setup_voicemail'].includes(action) && !['owner', 'administrator'].includes(agent.role)) return respond({ error: 'Administrator access is required.' }, 403);
  const { data: rows, error: configError } = await supabase.from('system_config').select('key,value')
    .in('key', ['zadarma_api_key', 'zadarma_api_secret']);
  if (configError) return respond({ error: 'Phone service settings are unavailable.' }, 503);
  const config = Object.fromEntries((rows || []).map((row: { key: string; value: string }) => [row.key, row.value]));
  const key = Deno.env.get('ZADARMA_API_KEY') || config.zadarma_api_key || '';
  const secret = Deno.env.get('ZADARMA_API_SECRET') || config.zadarma_api_secret || '';
  if (!key || !secret) return respond({ error: 'Zadarma API key and secret must be configured on the server.' }, 503);
  async function request(path: string, params: Params = {}, method = 'GET') {
    const signed = signZadarma(path, params, secret);
    const response = await fetch(`https://api.zadarma.com${path}${method === 'GET' && signed.query ? `?${signed.query}` : ''}`, {
      method, headers: { Authorization: `${key}:${signed.signature}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(method === 'GET' ? {} : { body: signed.query }), signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success') throw new Error(String(data.message || `Zadarma returned HTTP ${response.status}`).slice(0, 240));
    return data;
  }
  try {
    if (action === 'zadarma_setup_webrtc') {
      let info = await request('/v1/webrtc/');
      if (!info.is_exists) await request('/v1/webrtc/create/', { domain: DOMAIN }, 'POST');
      else if (!info.domains?.includes(DOMAIN)) await request('/v1/webrtc/domain/', { domain: DOMAIN }, 'POST');
      info = await request('/v1/webrtc/');
      if (!info.is_exists || !info.domains?.includes(DOMAIN)) return respond({ error: 'Zadarma has not authorized this website.' }, 409);
      return respond({ ok: true, domain: DOMAIN });
    }
    if (action === 'zadarma_check_incoming') {
      const [numbers, menus, pbxInfo] = await Promise.all([
        request('/v1/direct_numbers/'), request('/v1/pbx/ivr/'), request('/v1/pbx/internal/'),
      ]);
      const scenarios = await request('/v1/pbx/ivr/scenario/', { menu_id: '0' });
      return respond({ numbers, menus, scenarios, pbx_extensions: pbxInfo, domain: DOMAIN });
    }
    if (action === 'zadarma_setup_incoming') {
      return respond({ ok: false, code: 'INCOMING_ROUTE_SETUP_REQUIRED',
        error: 'Incoming routes need to be configured in the Zadarma PBX dashboard. Route each public number to its assigned extension, then verify an inbound call. Extension forwarding is not an incoming route.' }, 409);
    }
    if (action === 'zadarma_setup_voicemail') {
      const extension = String(body.extension || '');
      const email = String(body.email || 'albertbenitez3777@gmail.com');
      const greetingType = String(body.greeting_type || 'standart');
      if (!extension) return respond({ error: 'Provide extension number.' }, 400);
      if (!['standart', 'own', 'no'].includes(greetingType)) return respond({ error: 'greeting_type must be standart, own, or no.' }, 400);
      const results: Record<string, unknown> = {};
      try {
        results.current = await request('/v1/pbx/redirection/', { pbx_number: extension });
      } catch (e) { results.current_error = e instanceof Error ? e.message : String(e); }
      const redirectParams: Params = {
        pbx_number: extension,
        status: 'on',
        type: 'voicemail',
        destination: email,
        condition: 'noanswer',
        voicemail_greeting: greetingType,
      };
      try {
        results.setup = await request('/v1/pbx/redirection/', redirectParams, 'POST');
      } catch (e) { results.setup_error = e instanceof Error ? e.message : String(e); }
      try {
        results.verify = await request('/v1/pbx/redirection/', { pbx_number: extension });
      } catch (e) { results.verify_error = e instanceof Error ? e.message : String(e); }
      results.greeting_type_requested = greetingType;
      results.custom_greeting_note = greetingType === 'own'
        ? 'Custom greeting requires an mp3/wav file uploaded via POST /v1/pbx/ivr/sounds/upload or the Zadarma PBX dashboard. The redirection is configured to use a custom greeting once uploaded.'
        : undefined;
      return respond(results);
    }
    const sip = String(route.zadarma_sip_login || '');
    if (!/^\d+(?:-\d{3})?$/.test(sip)) return respond({ error: 'A valid Zadarma extension must be assigned to this agent.' }, 409);
    if (action === 'zadarma_webrtc_key') {
      const data = await request('/v1/webrtc/get_key/', { sip });
      if (!data.key) return respond({ error: 'Zadarma did not return a phone authorization key.' }, 502);
      return respond({ key: data.key, sip, number: route.talkroute_number, expires_in: 72 * 60 * 60, domain: DOMAIN });
    }
    const raw = String(body.to || '').trim();
    if (!/^[+\d\s().-]+$/.test(raw)) return respond({ error: 'Enter a valid phone number.' }, 400);
    const digits = raw.replace(/\D/g, '');
    const to = !raw.startsWith('+') && digits.length === 10 ? `1${digits}` : digits;
    if (!/^[1-9]\d{7,14}$/.test(to)) return respond({ error: 'Include the country code and full phone number.' }, 400);
    const extension = sip.includes('-') ? sip.split('-')[1] : sip;
    // Kept for compatibility with the old frontend; the repaired phone dials
    // directly through the SDK and never starts a parallel callback leg.
    await request('/v1/request/callback/', { from: extension, sip: extension, to });
    return respond({ ok: true, message: `Answer extension ${extension} to connect the callback.` });
  } catch (error) {
    return respond({ error: error instanceof Error && error.name === 'TimeoutError' ? 'Zadarma timed out. Try again.' : error instanceof Error ? error.message : 'Zadarma is unavailable.' }, 502);
  }
}

