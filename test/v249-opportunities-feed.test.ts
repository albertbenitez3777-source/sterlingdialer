// v249 — Opportunities feed: server API, role isolation, ET boundaries, UI compliance
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
const OPP_FEED = readFileSync(join(ROOT, 'src', 'components', 'OpportunitiesFeed.tsx'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const INDEX_TS = readFileSync(join(ROOT, 'src', 'components', 'index.ts'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');

describe('v249 Opportunities Feed', () => {
  describe('Server action: get_agent_opportunities', () => {
    it('action handler exists', () => { expect(PROVIDER).toContain('action === "get_agent_opportunities"'); });
    it('authenticates session', () => { expect(PROVIDER).toContain('verifySession(session_token)'); });
    it('scopes by agent_id', () => { expect(PROVIDER.includes('agent.id') && PROVIDER.includes('targetAgentId')).toBe(true); });
    it('owner can filter by agent', () => { expect(PROVIDER.includes('filter_agent_id') && PROVIDER.includes('isAdmin')).toBe(true); });
    it('agent_id filter applied', () => { expect(!PROVIDER.includes('get_agent_opportunities') || PROVIDER.includes('eq("agent_id"')).toBe(true); });
  });

  describe('Query criteria', () => {
    it('uses RPC for opportunity filtering', () => { expect(PROVIDER.includes('get_agent_opportunities') && PROVIDER.includes('p_agent_id')).toBe(true); });
    it('reads RPC result', () => { expect(PROVIDER).toContain('rpcResult'); });
    it('reads rows from RPC', () => { expect(PROVIDER).toContain('result.rows'); });
  });

  describe('Server-side ET boundaries', () => {
    it('uses America/New_York timezone', () => { expect(PROVIDER.includes('America/New_York') || PROVIDER.includes('server_today_start')).toBe(true); });
    it('computes today start in ET', () => { expect(PROVIDER.includes('todayStartISO') || PROVIDER.includes('server_today_start')).toBe(true); });
    it('computes week start', () => { expect(PROVIDER.includes('server_week_start') || PROVIDER.includes('weekStartISO')).toBe(true); });
    it('tab selection', () => { expect(PROVIDER.includes('selectedTab') || PROVIDER.includes('p_tab')).toBe(true); });
    it('handles week and all tabs', () => { expect(PROVIDER.includes('"week"') && PROVIDER.includes('"all"')).toBe(true); });
  });

  describe('Response shape', () => {
    it('includes recording_url', () => { expect(PROVIDER).toContain('recording_url'); });
    it('includes ai_summary', () => { expect(PROVIDER).toContain('ai_summary'); });
    it('includes transcript', () => { expect(PROVIDER).toContain('transcript'); });
    it('includes bridge_confirmed_at', () => { expect(PROVIDER).toContain('bridge_confirmed_at'); });
    it('includes transfer_requested_at', () => { expect(PROVIDER).toContain('transfer_requested_at'); });
    it('includes talkroute_leg_created', () => { expect(PROVIDER).toContain('talkroute_leg_created'); });
    it('returns counts object', () => { expect(PROVIDER).toContain('counts'); });
  });

  describe('OpportunitiesFeed component', () => {
    it('component exported', () => { expect(OPP_FEED).toContain('OpportunitiesFeed'); });
    it('three tabs', () => { expect(OPP_FEED.includes("'today'") && OPP_FEED.includes("'week'") && OPP_FEED.includes("'all'")).toBe(true); });
    it('Human/Live Human badge', () => { expect(OPP_FEED.includes('Human Detected') || OPP_FEED.includes('Live Human')).toBe(true); });
    it('Transfer Requested badge', () => { expect(OPP_FEED).toContain('Transfer Requested'); });
    it('Talkroute Dialed badge', () => { expect(OPP_FEED).toContain('Talkroute Dialed'); });
    it('Agent Answered badge', () => { expect(OPP_FEED).toContain('Agent Answered'); });
    it('Bridge Confirmed badge', () => { expect(OPP_FEED).toContain('Bridge Confirmed'); });
  });

  describe('Recording player with recovery', () => {
    it('uses RecordingPlayer', () => { expect(OPP_FEED).toContain('RecordingPlayer'); });
    it('passes callId for recovery', () => { expect(OPP_FEED).toContain('callId={r.id}'); });
    it('passes sessionToken for recovery', () => { expect(OPP_FEED).toContain('sessionToken={sessionToken}'); });
  });

  describe('Callback/redial action', () => {
    it('has onCallback prop', () => { expect(OPP_FEED).toContain('onCallback'); });
    it('shows Callback button', () => { expect(OPP_FEED).toContain('Callback'); });
    it('uses consumer phone', () => { expect(OPP_FEED).toContain('consumer_phone'); });
  });

  describe('Auto-refresh', () => {
    it('sets up interval', () => { expect(OPP_FEED).toContain('setInterval'); });
    it('10-12-second interval', () => { expect(OPP_FEED.includes('10_000') || OPP_FEED.includes('12_000')).toBe(true); });
    it('cleans up interval', () => { expect(OPP_FEED).toContain('clearInterval'); });
  });

  describe('Loading/empty/error states', () => {
    it('loading state', () => { expect(OPP_FEED).toContain('Loading opportunities'); });
    it('empty state', () => { expect(OPP_FEED).toContain('No opportunities yet'); });
    it('error state', () => { expect(OPP_FEED).toContain('opp-error'); });
  });

  describe('App.tsx integration', () => {
    it('imported in App', () => { expect(APP).toContain('OpportunitiesFeed'); });
    it('opportunities nav item', () => { expect(APP).toContain("'opportunities'"); });
    it('opportunities route', () => { expect(APP).toContain("activeNav === 'opportunities'"); });
    it('exported from index', () => { expect(INDEX_TS).toContain('OpportunitiesFeed'); });
  });

  describe('Role isolation', () => {
    const oppStart = PROVIDER.indexOf('action === "get_agent_opportunities"');
    const oppSection = PROVIDER.slice(oppStart, oppStart + 5000);
    it('filters by agent_id for non-admin', () => { expect(oppSection.includes('targetAgentId') || oppSection.includes('p_agent_id')).toBe(true); });
    it('owner can override filter', () => { expect(oppSection).toContain('isAdmin && filter_agent_id'); });
  });

  describe('Responsive design', () => {
    it('mobile breakpoint for opp cards', () => { expect(CSS.includes('opp-card-header') && CSS.includes('640px')).toBe(true); });
  });

  describe('Owner nav', () => {
    it('opportunities in nav items', () => { expect(APP).toContain("{ id: 'opportunities'"); });
  });
});
