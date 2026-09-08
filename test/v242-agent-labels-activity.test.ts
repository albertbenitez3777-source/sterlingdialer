// v242 Agent Label Accuracy, Today Activity, Eastern Time Reconciliation — Fixtures
// NOTE: Many original v242 assertions target App.tsx patterns that have since been
// refactored into AgentWorkspaceView.tsx and AgentCockpit.tsx. Assertions below are
// updated to check the current file locations where the features now live.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
const COCKPIT = readFileSync(join(ROOT, 'src', 'components', 'AgentCockpit.tsx'), 'utf-8');
const WORKSPACE = readFileSync(join(ROOT, 'src', 'components', 'AgentWorkspaceView.tsx'), 'utf-8');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');

describe('v242 Agent Labels & Today Activity', () => {
  describe('Cockpit pipeline labels', () => {
    it('cockpit: Active Now', () => { expect(COCKPIT).toContain("'Active Now'"); });
    it('cockpit: Live Humans Today', () => { expect(COCKPIT).toContain("'Live Humans Today'"); });
    it('cockpit: Transfers Today', () => { expect(COCKPIT).toContain("'Transfers Today'"); });
    it('cockpit: Today Total', () => { expect(COCKPIT).toContain("'Today Total'"); });
    it('cockpit uses active_calls_now', () => { expect(COCKPIT).toContain('active_calls_now'); });
    it('cockpit uses today_total', () => { expect(COCKPIT).toContain('today_total'); });
  });

  describe('Active calls sourced from stats', () => {
    it('agentTodayStats state exists', () => { expect(APP).toContain('agentTodayStats'); });
    it('setAgentTodayStats setter', () => { expect(APP).toContain('setAgentTodayStats'); });
  });

  describe('Eastern Time', () => {
    it('Eastern TZ in application', () => { expect(APP.includes('America/New_York') || COCKPIT.includes('America/New_York') || CSS.includes('America/New_York')).toBe(true); });
  });

  describe('Activity badges in CSS', () => {
    it('active badge style', () => { expect(CSS).toContain('.badge-active'); });
    it('fire badge style', () => { expect(CSS).toContain('.badge-fire'); });
  });

  describe('Workspace fire transfer badge', () => {
    it('fire_transfer badge in workspace', () => { expect(WORKSPACE).toContain('fire_transfer'); });
  });

  describe('Provider returns activity', () => {
    it('provider calls activity RPC', () => { expect(PROVIDER).toContain('get_agent_today_activity'); });
    it('provider returns today_activity', () => { expect(PROVIDER).toContain('today_activity'); });
    it('parallel RPC calls', () => { expect(PROVIDER).toContain('Promise.all'); });
  });

  describe('Activity CSS', () => {
    it('section class', () => { expect(CSS).toContain('.today-activity-section'); });
    it('row class', () => { expect(CSS).toContain('.today-activity-row'); });
    it('time class', () => { expect(CSS).toContain('.today-activity-time'); });
    it('name class', () => { expect(CSS).toContain('.today-activity-name'); });
    it('badge class', () => { expect(CSS).toContain('.activity-badge'); });
  });

  describe('Auth preserved', () => {
    for (const term of ['authFetch', 'sessionToken', 'atomicLogout', 'onUnauthorized']) {
      it(term, () => { expect(APP).toContain(term); });
    }
  });

  describe('Campaign/routing preserved', () => {
    it('dialer report ref', () => { expect(APP).toContain('wolf-dialer-report'); });
    it('talkroute preserved', () => { expect(APP).toContain('talkroute_destination'); });
    it('preflight preserved', () => { expect(APP).toContain('StartPreflightModal'); });
  });
});
