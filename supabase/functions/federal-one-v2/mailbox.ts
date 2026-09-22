import { zadarmaClient } from './zadarma.ts';
import { verifiedTestRoute } from './test-calls.ts';
const adminRoles = ['owner', 'administrator'];
export async function voicemailReceiverConfigured(db: any): Promise<boolean> {
  if ((Deno.env.get('VOICEMAIL_INGEST_SECRET') || '').length >= 32) return true;
  const { data } = await db.from('system_config').select('value').eq('key', 'voicemail_email_adapter_active').maybeSingle();
  return data?.value === 'true';
}
export function validMailboxEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(email) || /\.(local|invalid|test|example)$/i.test(email)) {
    throw new Error('Enter a real mailbox address for voicemail delivery.');
  }
  return email;
}
export async function mailbox(db: any, agent: {id: string; role: string}, body: Record<string, unknown>) {
  const reply = (data: unknown, status = 200) => ({ data, status });
  const action = String(body.action || '');
  if (action === 'mailbox_setup' || action === 'mailbox_config') {
    if (!adminRoles.includes(agent.role)) return reply({ error: 'Administrator access is required.' }, 403);
    const { data: row, error } = await db.from('agents').select('id,full_name,bland_number,talkroute_number,zadarma_sip_login').eq('id', body.agent_id).single();
    if (error || !row) return reply({ error: 'Agent not found.' }, 404);
    try {
      const route = verifiedTestRoute(row);
      const request = await zadarmaClient(db);
      if (action === 'mailbox_setup') {
        const email = validMailboxEmail(body.email);
        const existing = await request('/v1/pbx/redirection/', { pbx_number: route.extension });
        // Preserve the agent's uploaded greeting when delivery is configured again.
        const greeting = existing.voicemail_greeting === 'own' ? 'own' : 'standart';
        await request('/v1/pbx/redirection/', { pbx_number: route.extension, status: 'on', type: 'voicemail',
          condition: 'noanswer', destination: email, voicemail_greeting: greeting }, 'POST');
      }
      const data = await request('/v1/pbx/redirection/', { pbx_number: route.extension });
      const { data: latestMessage } = await db.from('federal_one_voicemails').select('id')
        .eq('agent_id', row.id).limit(1).maybeSingle();
      const receiverConfigured = await voicemailReceiverConfigured(db);
      return reply({ configured: data.current_status === 'on' && data.type === 'voicemail',
        email: data.type === 'voicemail' ? data.destination : '', condition: data.condition || null,
        greeting: data.voicemail_greeting || null,
        inbox_connected: receiverConfigured && Boolean(latestMessage),
        inbox_receiving_configured: receiverConfigured, delivery_verified: Boolean(latestMessage) });
    } catch (e) { return reply({ error: e instanceof Error ? e.message : 'Voicemail setup could not be verified.' }, 400); }
  }
  // Session identity determines the mailbox. A supplied agent_id is never used.
  if (action === 'mailbox_list') {
    const { data, error } = await db.from('federal_one_voicemails')
      .select('id,caller_number,caller_name,received_at,duration_seconds,heard_at')
      .eq('agent_id', agent.id).order('received_at', { ascending: false }).limit(100);
    if (error) return reply({ error: 'Voicemail could not be loaded. Please retry.' }, 503);
    return reply({ messages: data, delivery_verified: data.length > 0 });
  }
  if (!['mailbox_audio', 'mailbox_heard'].includes(action)) return reply({ error: 'Unknown mailbox action.' }, 400);
  const { data: message, error } = await db.from('federal_one_voicemails').select('id,storage_path')
    .eq('id', body.id).eq('agent_id', agent.id).single();
  if (error || !message) return reply({ error: 'Message not found.' }, 404);
  if (action === 'mailbox_heard') {
    const updated = await db.from('federal_one_voicemails').update({ heard_at: new Date().toISOString() })
      .eq('id', message.id).eq('agent_id', agent.id);
    return updated.error ? reply({ error: 'Could not mark this message as heard.' }, 503) : reply({ ok: true });
  }
  const { data, error: signedError } = await db.storage.from('agent-voicemail').createSignedUrl(message.storage_path, 300);
  return signedError ? reply({ error: 'The voicemail audio is unavailable.' }, 503) : reply({ url: data.signedUrl });
}
