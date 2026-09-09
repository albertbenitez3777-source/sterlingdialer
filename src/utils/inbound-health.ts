export type InboundRoute = {
  agent_id: string; name: string; selected: boolean; agent_ready: boolean;
  http_status: number; configuration_ready: boolean; error?: string;
  transfer_matches?: boolean; callback_authenticated?: boolean; presence_lookup?: boolean;
  prompt_has_transfer_tool?: boolean; prompt_blocks_transfer?: boolean; events_verified?: boolean;
  recording_enabled?: boolean; pathway_clear?: boolean;
};

export type InboundHealth = {
  checked_at: string; ready_agent_count: number; selected_agent_count: number;
  configuration_ready: boolean; results: InboundRoute[];
};

// An older endpoint response or a saved flag cannot pass current preflight.
export function currentInboundHealth(value: unknown, now = Date.now()): InboundHealth | null {
  if (!value || typeof value !== 'object') return null;
  const health = value as InboundHealth;
  const age = now - Date.parse(health.checked_at);
  if (!Number.isFinite(age) || age < -5000 || age > 60000 || !Array.isArray(health.results)) return null;
  if (!Number.isInteger(health.ready_agent_count) || health.ready_agent_count < 0 ||
      !Number.isInteger(health.selected_agent_count) || health.selected_agent_count < 0 ||
      typeof health.configuration_ready !== 'boolean') return null;
  if (health.results.some(r => !r || typeof r.agent_id !== 'string' || typeof r.name !== 'string' ||
      typeof r.selected !== 'boolean' || typeof r.agent_ready !== 'boolean' ||
      typeof r.configuration_ready !== 'boolean' || typeof r.http_status !== 'number')) return null;
  const selected = health.results.filter(r => r.selected);
  if (selected.length !== health.selected_agent_count ||
      selected.filter(r => r.agent_ready).length !== health.ready_agent_count) return null;
  const routesReady = selected.length > 0 && selected.every(r => r.http_status === 200 &&
    r.configuration_ready && inboundRouteProblems(r).length === 0);
  if (health.configuration_ready !== routesReady) return null;
  return health;
}

export function inboundRouteProblems(route: InboundRoute): string[] {
  if (route.http_status !== 200) return ['Provider readback unavailable'];
  const problems: string[] = [];
  if (!route.transfer_matches) problems.push('Transfer destination mismatch');
  if (!route.callback_authenticated) problems.push('Callback mismatch');
  if (!route.presence_lookup) problems.push('Availability lookup mismatch');
  if (!route.prompt_has_transfer_tool || route.prompt_blocks_transfer !== false) problems.push('Transfer instructions need repair');
  if (!route.events_verified) problems.push('Call events missing');
  if (!route.recording_enabled) problems.push('Recording disabled');
  if (!route.pathway_clear) problems.push('A separate pathway overrides the prompt');
  return problems;
}
