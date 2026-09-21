import { createHash, createHmac } from 'node:crypto';

const DOMAIN = 'wolf-of-wall-street-ssy3.bolt.host';
type Params = Record<string, string>;

export function signZadarma(method: string, params: Params, secret: string) {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
  const digest = createHash('md5').update(query).digest('hex');
  const signature = btoa(createHmac('sha1', secret).update(method + query + digest).digest('hex'));
  return { query, signature };
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
      .eq('assigned_agent_id', agent.id).eq('telephone_normalized', last10).limit(1);
    const lead = leads?.[0];
    return respond({ caller: lead ? { name: lead.name, phone: lead.telephone_original, address: lead.address, fields: lead.custom_fields } : null });
  }

  if (!['zadarma_callback', 'zadarma_webrtc_key', 'zadarma_setup_webrtc'].includes(action)) return respond({ error: 'Unknown phone action.' }, 400);
  if (action === 'zadarma_setup_webrtc' && !['owner', 'administrator'].includes(agent.role)) return respond({ error: 'Owner access is required to configure the phone service.' }, 403);
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
