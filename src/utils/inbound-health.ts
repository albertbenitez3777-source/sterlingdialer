type RouteResult = {
  agent_id: string;
  full_name: string;
  bland_number?: string;
  talkroute_number?: string;
  inbound_configured?: boolean;
  configuration_ready?: boolean;
  agent_ready?: boolean;
  last_verified_at?: string;
  [key: string]: unknown;
};

export type InboundHealth = {
  results: RouteResult[];
  ready_agent_count: number;
  selected_agent_count: number;
  configuration_ready: boolean;
  checked_at: string;
};

export function currentInboundHealth(data: unknown): InboundHealth | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const results = (d.results || d.agents || []) as RouteResult[];
  const ready = results.filter(r => r.configuration_ready);
  return {
    results,
    ready_agent_count: ready.length,
    selected_agent_count: results.length,
    configuration_ready: ready.length === results.length && results.length > 0,
    checked_at: (d.checked_at as string) || new Date().toISOString(),
  };
}

export function inboundRouteProblems(route: RouteResult): string[] {
  const problems: string[] = [];
  if (!route.bland_number) problems.push('No inbound line assigned');
  if (!route.talkroute_number) problems.push('No Talkroute destination');
  if (route.inbound_configured === false) problems.push('Inbound not configured');
  if (route.configuration_ready === false && route.bland_number && route.talkroute_number) {
    problems.push('Route check failed');
  }
  return problems;
}
